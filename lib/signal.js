(function (root, mod) {
    if (typeof exports === 'object' && typeof module === 'object') // CommonJS
    { return mod(exports); }
    if (typeof define === 'function' && define.amd) // AMD
    { return define(['exports'], mod); }
    mod((root.tern || (root.tern = {})).signal = {}); // Plain browser env
}(this, (exports) => {
    function on(type, f) {
        const handlers = this._handlers || (this._handlers = Object.create(null));
        (handlers[type] || (handlers[type] = [])).push(f);
    }

    function off(type, f) {
        const arr = this._handlers && this._handlers[type];
        if (arr) { for (let i = 0; i < arr.length; ++i) if (arr[i] == f) { arr.splice(i, 1); break; } }
    }

    const noHandlers = [];
    function getHandlers(emitter, type) {
        const arr = emitter._handlers && emitter._handlers[type];
        return arr && arr.length ? arr.slice() : noHandlers;
    }

    function signal(type, a1, a2, a3, a4) {
        const arr = getHandlers(this, type);
        for (let i = 0; i < arr.length; ++i) arr[i].call(this, a1, a2, a3, a4);
    }

    function signalReturnFirst(type, a1, a2, a3, a4) {
        const arr = getHandlers(this, type);
        for (let i = 0; i < arr.length; ++i) {
            const result = arr[i].call(this, a1, a2, a3, a4);
            if (result) return result;
        }
    }

    function hasHandler(type) {
        const arr = this._handlers && this._handlers[type];
        return arr && arr.length > 0 && arr;
    }

    exports.mixin = function (obj) {
        obj.on = on; obj.off = off;
        obj.signal = signal;
        obj.signalReturnFirst = signalReturnFirst;
        obj.hasHandler = hasHandler;
        return obj;
    };
}));
