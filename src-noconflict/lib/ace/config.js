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

    const lang = require('./lib/lang');
    const oop = require('./lib/oop');
    const net = require('./lib/net');
    const { AppConfig } = require('./lib/app_config');

    module.exports = exports = new AppConfig();

    const global = (function () {
        return this || typeof window !== 'undefined' && window;
    }());

    const options = {
        packaged: false,
        workerPath: null,
        modePath: null,
        themePath: null,
        basePath: '',
        suffix: '.js',
        $moduleUrls: {},
        loadWorkerFromBlob: true,
        sharedPopups: false,
    };

    exports.get = function (key) {
        if (!options.hasOwnProperty(key)) throw new Error(`Unknown config key: ${key}`);

        return options[key];
    };

    exports.set = function (key, value) {
        if (options.hasOwnProperty(key)) options[key] = value;
        else if (this.setDefaultValue('', key, value) == false) throw new Error(`Unknown config key: ${key}`);
    };

    exports.all = function () {
        return lang.copyObject(options);
    };

    exports.$modes = {};

    // module loading
    exports.moduleUrl = function (name, component) {
        if (options.$moduleUrls[name]) return options.$moduleUrls[name];

        const parts = name.split('/');
        component = component || parts[parts.length - 2] || '';

        // todo make this configurable or get rid of '-'
        let sep = component == 'snippets' ? '/' : '-';
        let base = parts[parts.length - 1];
        if (component == 'worker' && sep == '-') {
            const re = new RegExp(`^${component}[\\-_]|[\\-_]${component}$`, 'g');
            base = base.replace(re, '');
        }

        if ((!base || base == component) && parts.length > 1) base = parts[parts.length - 2];
        let path = options[`${component}Path`];
        if (path == null) {
            path = options.basePath;
        } else if (sep == '/') {
            component = sep = '';
        }
        if (path && path.slice(-1) != '/') path += '/';
        return path + component + sep + base + this.get('suffix');
    };

    exports.setModuleUrl = function (name, subst) {
        return options.$moduleUrls[name] = subst;
    };

    exports.$loading = {};
    exports.loadModule = function (moduleName, onLoad) {
        let module; let
            moduleType;
        if (Array.isArray(moduleName)) {
            moduleType = moduleName[0];
            moduleName = moduleName[1];
        }

        try {
            module = require(moduleName);
        } catch (e) {}
        // require(moduleName) can return empty object if called after require([moduleName], callback)
        if (module && !exports.$loading[moduleName]) return onLoad && onLoad(module);

        if (!exports.$loading[moduleName]) exports.$loading[moduleName] = [];

        exports.$loading[moduleName].push(onLoad);

        if (exports.$loading[moduleName].length > 1) return;

        const afterLoad = function () {
            require([moduleName], (module) => {
                exports._emit('load.module', { name: moduleName, module });
                const listeners = exports.$loading[moduleName];
                exports.$loading[moduleName] = null;
                listeners.forEach((onLoad) => {
                    onLoad && onLoad(module);
                });
            });
        };

        if (!exports.get('packaged')) return afterLoad();

        net.loadScript(exports.moduleUrl(moduleName, moduleType), afterLoad);
        reportErrorIfPathIsNotConfigured();
    };

    var reportErrorIfPathIsNotConfigured = function () {
        if (
            !options.basePath && !options.workerPath
        && !options.modePath && !options.themePath
        && !Object.keys(options.$moduleUrls).length
        ) {
            console.error(
                'Unable to infer path to ace from script src,',
                "use ace.config.set('basePath', 'path') to enable dynamic loading of modes and themes",
                'or with webpack use ace/webpack-resolver',
            );
            reportErrorIfPathIsNotConfigured = function () {};
        }
    };

    // initialization
    function init(packaged) {
        if (!global || !global.document) return;

        options.packaged = packaged || require.packaged || module.packaged || (global.define && define.packaged);

        const scriptOptions = {};
        let scriptUrl = '';

        // Use currentScript.ownerDocument in case this file was loaded from imported document. (HTML Imports)
        const currentScript = (document.currentScript || document._currentScript); // native or polyfill
        const currentDocument = currentScript && currentScript.ownerDocument || document;

        const scripts = currentDocument.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];

            const src = script.src || script.getAttribute('src');
            if (!src) continue;

            const { attributes } = script;
            for (let j = 0, l = attributes.length; j < l; j++) {
                const attr = attributes[j];
                if (attr.name.indexOf('data-ace-') === 0) {
                    scriptOptions[deHyphenate(attr.name.replace(/^data-ace-/, ''))] = attr.value;
                }
            }

            const m = src.match(/^(.*)\/ace(\-\w+)?\.js(\?|$)/);
            if (m) scriptUrl = m[1];
        }

        if (scriptUrl) {
            scriptOptions.base = scriptOptions.base || scriptUrl;
            scriptOptions.packaged = true;
        }

        scriptOptions.basePath = scriptOptions.base;
        scriptOptions.workerPath = scriptOptions.workerPath || scriptOptions.base;
        scriptOptions.modePath = scriptOptions.modePath || scriptOptions.base;
        scriptOptions.themePath = scriptOptions.themePath || scriptOptions.base;
        delete scriptOptions.base;

        for (const key in scriptOptions) if (typeof scriptOptions[key] !== 'undefined') exports.set(key, scriptOptions[key]);
    }

    exports.init = init;

    function deHyphenate(str) {
        return str.replace(/-(.)/g, (m, m1) => m1.toUpperCase());
    }

    exports.version = '1.4.7';
});
