/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define((require, exports, module) => {
    'no use strict';

    const oop = require('./oop');
    const { EventEmitter } = require('./event_emitter');

    const optionsProvider = {
        setOptions(optList) {
            Object.keys(optList).forEach(function (key) {
                this.setOption(key, optList[key]);
            }, this);
        },
        getOptions(optionNames) {
            let result = {};
            if (!optionNames) {
                const options = this.$options;
                optionNames = Object.keys(options).filter((key) => !options[key].hidden);
            } else if (!Array.isArray(optionNames)) {
                result = optionNames;
                optionNames = Object.keys(result);
            }
            optionNames.forEach(function (key) {
                result[key] = this.getOption(key);
            }, this);
            return result;
        },
        setOption(name, value) {
            if (this[`$${name}`] === value) return;
            const opt = this.$options[name];
            if (!opt) {
                return warn(`misspelled option "${name}"`);
            }
            if (opt.forwardTo) return this[opt.forwardTo] && this[opt.forwardTo].setOption(name, value);

            if (!opt.handlesSet) this[`$${name}`] = value;
            if (opt && opt.set) opt.set.call(this, value);
        },
        getOption(name) {
            const opt = this.$options[name];
            if (!opt) {
                return warn(`misspelled option "${name}"`);
            }
            if (opt.forwardTo) return this[opt.forwardTo] && this[opt.forwardTo].getOption(name);
            return opt && opt.get ? opt.get.call(this) : this[`$${name}`];
        },
    };

    function warn(message) {
        if (typeof console !== 'undefined' && console.warn) console.warn.apply(console, arguments);
    }

    function reportError(msg, data) {
        const e = new Error(msg);
        e.data = data;
        if (typeof console === 'object' && console.error) console.error(e);
        setTimeout(() => { throw e; });
    }

    const AppConfig = function () {
        this.$defaultOptions = {};
    };

    (function () {
    // module loading
        oop.implement(this, EventEmitter);
        /*
     * option {name, value, initialValue, setterName, set, get }
     */
        this.defineOptions = function (obj, path, options) {
            if (!obj.$options) this.$defaultOptions[path] = obj.$options = {};

            Object.keys(options).forEach((key) => {
                let opt = options[key];
                if (typeof opt === 'string') opt = { forwardTo: opt };

                opt.name || (opt.name = key);
                obj.$options[opt.name] = opt;
                if ('initialValue' in opt) obj[`$${opt.name}`] = opt.initialValue;
            });

            // implement option provider interface
            oop.implement(obj, optionsProvider);

            return this;
        };

        this.resetOptions = function (obj) {
            Object.keys(obj.$options).forEach((key) => {
                const opt = obj.$options[key];
                if ('value' in opt) obj.setOption(key, opt.value);
            });
        };

        this.setDefaultValue = function (path, name, value) {
            if (!path) {
                for (path in this.$defaultOptions) if (this.$defaultOptions[path][name]) break;
                if (!this.$defaultOptions[path][name]) return false;
            }
            const opts = this.$defaultOptions[path] || (this.$defaultOptions[path] = {});
            if (opts[name]) {
                if (opts.forwardTo) this.setDefaultValue(opts.forwardTo, name, value);
                else opts[name].value = value;
            }
        };

        this.setDefaultValues = function (path, optionHash) {
            Object.keys(optionHash).forEach(function (key) {
                this.setDefaultValue(path, key, optionHash[key]);
            }, this);
        };

        this.warn = warn;
        this.reportError = reportError;
    }).call(AppConfig.prototype);

    exports.AppConfig = AppConfig;
});