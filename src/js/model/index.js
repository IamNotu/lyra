/* eslint no-undefined: 0 */
'use strict';
var dl = require('datalib'),
    vg = require('vega'),
    sg = require('./signals'),
    manips = require('./primitives/marks/manipulators'),
    ns = require('../util/ns');

/** @namespace */
var model = module.exports = {
  view: null,
  Scene: null
};

var pipelines = [], scales = [],
    primitives = {},
    listeners = {};

/**
 * Initializes the Lyra model with a new Scene primitive.
 * @returns {Object} The Lyra Model
 */
model.init = function() {
  var Scene = require('./primitives/marks/Scene');
  model.Scene = new Scene().init();
  return this;
};

/**
 * @description A setter for primitives based on IDs. To prevent memory leaks,
 * primitives do not directly store references to other primitives. Instead,
 * they store IDs and use model.lookup as a lookup. When a new primitive is
 * created, it calls this function to store itself in the model.
 *
 * @param {number} id - The numeric ID of the primitive to set.
 * @param {Object} primitive - Store the provided primitive in the lyra model,
 * keyed by the given ID.
 * @returns {Object} The Lyra model.
 */
model.primitive = function(id, primitive) {
  primitives[id] = primitive;
  return model;
};

/**
 * @description A getter for primitives based on IDs. Primitives store their IDs
 * in the model and use this method as a lookup.
 *
 * @param {number} id - The numeric ID of a specific primitive to look up.
 * @returns {Object} The Lyra model.
 */
var lookup = model.lookup = function(id) {
  return primitives[id];
};

function getset(cache, id, Type) {
  if (id === undefined) {
    return cache.map(function(x) {
      return lookup(x);
    });
  } else if (dl.isNumber(id)) {
    return lookup(id);
  }
  var obj = dl.isString(id) ? new Type(id) : id;
  return (cache.push(obj._id), obj);
}


function register() {
  var components = require('../components'),
      win = d3.select(window),
      dragover = 'dragover.altchan',
      signalName, handlers, i, len;

  // Register a window dragover event handler to detect shiftKey
  // presses for alternate channel manipulators.
  if (!win.on(dragover)) {
    win.on(dragover, function() {
      var mode = model.signal(sg.MODE),
          shiftKey = d3.event.shiftKey,
          prevKey = Boolean(model._shiftKey);

      if (prevKey === shiftKey) {
        return;
      }
      model._shiftKey = shiftKey;
      var setAltChan = mode === 'altchannels' ? 'channels' : mode;
      model.signal(sg.MODE, mode === 'channels' ? 'altchannels' : setAltChan).update();
    });
  }

  model.view.onSignal(sg.SELECTED, function(name, selected) {
    var def = selected.mark.def,
        id = def && def.lyra_id;
    if (id) {
      components.select(id, false);
    }
  });

  for (signalName in listeners) {
    handlers = listeners[signalName];
    for (i = 0, len = handlers.length; i < len; ++i) {
      model.view.onSignal(signalName, handlers[i]);
    }
  }
}

/**
 * A getter or creator for Pipelines.
 * @param  {number|string} [id] - The numeric ID of an existing Pipeline to retrieve
 * or the name of a new Pipeline to instantiate. If no id is given, returns all
 * Pipelines.
 * @returns {Object|Object[]} A Pipeline or array of Pipelines.
 */
model.pipeline = function(id) {
  return getset(pipelines, id, require('./primitives/data/Pipeline'));
};

/**
 * A getter or creator for Scales.
 * @param  {number|string} [id] - The numeric ID of an existing Scale to retrieve
 * or the name of a new Scale to instantiate. If no id is given, returns all
 * Scales.
 * @returns {Object|Object[]} A Scale or array of Scales.
 */
model.scale = function(id) {
  return getset(scales, id, require('./primitives/Scale'));
};

/**
 * Gets or sets the value of a signal both within the model and with the parsed
 * Vega view (if available).
 * @param  {string} name - The name of a signal.
 * @param  {*} [value] The signal value to be set.
 * @returns {*} The signal value if called as a getter, the model if called as
 * a setter.
 */
model.signal = function() {
  var ret = sg.value.apply(sg, arguments);
  return ret === sg ? model : ret;
};

/**
 * Exports the model as a complete Vega specification.
 * @param  {Object}  [scene] - An exported specification of the Scene.
 * @param  {boolean} [clean=true] - Should Lyra-specific properties be removed
 * or resolved (e.g., converting property signal references to actual values).
 * @returns {Object} A Vega specification.
 */
model.export = function(scene, clean) {
  clean = clean || clean === undefined;
  var spec = scene || model.Scene.export(clean);

  spec.data = pipelines.reduce(function(arr, id) {
    return (arr.push.apply(arr, lookup(id).export(clean)), arr);
  }, []);

  return spec;
};

/**
 * Exports the model as a complete Vega specification with extra definitions
 * to power Lyra-specific interaction. In particular, this includes definitions
 * of all the Lyra-specific signals and manipulators (handles, channels, etc.).
 * @returns {Object} A Vega specification.
 */
model.manipulators = function() {
  var spec = model.export(model.Scene.manipulators(), false),
      data = spec.data || (spec.data = []),
      signals = spec.signals || (spec.signals = []),
      predicates = spec.predicates || (spec.predicates = []),
      marks = spec.marks || (spec.marks = []),
      idx = dl.comparator('_idx');


  signals.push.apply(signals, dl.vals(sg.stash()).sort(idx));
  predicates.push({
    name: sg.CELL,
    type: '==',
    operands: [{signal: sg.CELL + '.key'}, {arg: 'key'}]
  });

  data.push({
    name: 'bubble_cursor',
    transform: [{type: ns('bubble_cursor')}]
  });

  marks.push(manips.BUBBLE_CURSOR);
  data.push({
    name: 'dummy_data_line',
    values: [
      {
        foo: 100,
        bar: 100
      },
      {
        foo: 200,
        bar: 200
      }
    ]
  });
  // I don't want line and area to overlap. When we have the option to drag onto the scene,
  // I would change this
  data.push({
    name: 'dummy_data_area',
    values: [
      {x: 100, y: 28},
      {x: 200, y: 55},
    ]
  });

  return spec;
};

/**
 * Parses the model's `manipulators` spec and renders the visualization.
 * @param  {string} [el] - A CSS selector corresponding to the DOM element
 * to render the visualization in.
 * @returns {Object} A Promise that resolves once the spec has been successfully
 * parsed and rendered.
 */
model.parse = function(el) {
  el = (el === undefined) ? '#vis' : el;
  if (model.view) {
    model.view.destroy();
  }
  return new Promise(function(resolve, reject) {
    vg.dataflow.Tuple.reset();
    vg.parse.spec(model.manipulators(), function(err, chart) {
      if (err) {
        reject(err);
      } else {
        model.view = chart({el: el});
        register();
        resolve(model.view);
      }
    });
  }).then(model.update);
};

/**
 * Re-renders the current spec (e.g., to account for new signal values).
 * @returns {Object} The Lyra model.
 */
model.update = function() {
  return (model.view.update(), model);
};

/**
 * Registers a signal value change handler.
 * @param  {string} name - The name of a signal.
 * @param  {Function} handler - The function to call when the value of the
 * named signal changes.
 * @returns {Object} The Lyra model.
 */
model.onSignal = function(name, handler) {
  var listener = listeners[name] || (listeners[name] = []);
  listener.push(handler);
  if (model.view) {
    model.view.onSignal(name, handler);
  }
  return model;
};

/**
 * Unregisters a signal value change handler.
 * @param  {string} name - The name of a signal.
 * @param  {Function} handler - The function to unregister; this function
 * should have previously been registered for this signal using `onSignal`.
 * @returns {Object} The Lyra model.
 */
model.offSignal = function(name, handler) {
  var listener = listeners[name] || (listeners[name] = []);
  for (var i = listener.length; --i >= 0;) {
    if (!handler || listener[i] === handler) {
      listener.splice(i, 1);
    }
  }
  if (model.view) {
    model.view.offSignal(name, handler);
  }
  return model;
};
