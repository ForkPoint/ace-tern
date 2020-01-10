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
    const useragent = require('./useragent');
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    exports.buildDom = function buildDom(arr, parent, refs) {
        if (typeof arr === 'string' && arr) {
            const txt = document.createTextNode(arr);
            if (parent) parent.appendChild(txt);
            return txt;
        }

        if (!Array.isArray(arr)) return arr;
        if (typeof arr[0] !== 'string' || !arr[0]) {
            const els = [];
            for (var i = 0; i < arr.length; i++) {
                const ch = buildDom(arr[i], parent, refs);
                ch && els.push(ch);
            }
            return els;
        }

        const el = document.createElement(arr[0]);
        const options = arr[1];
        let childIndex = 1;
        if (options && typeof options === 'object' && !Array.isArray(options)) childIndex = 2;
        for (var i = childIndex; i < arr.length; i++) buildDom(arr[i], el, refs);
        if (childIndex == 2) {
            Object.keys(options).forEach((n) => {
                const val = options[n];
                if (n === 'class') {
                    el.className = Array.isArray(val) ? val.join(' ') : val;
                } else if (typeof val === 'function' || n == 'value') {
                    el[n] = val;
                } else if (n === 'ref') {
                    if (refs) refs[val] = el;
                } else if (val != null) {
                    el.setAttribute(n, val);
                }
            });
        }
        if (parent) parent.appendChild(el);
        return el;
    };

    exports.getDocumentHead = function (doc) {
        if (!doc) doc = document;
        return doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
    };

    exports.createElement = function (tag, ns) {
        return document.createElementNS
            ? document.createElementNS(ns || XHTML_NS, tag)
            : document.createElement(tag);
    };

    exports.removeChildren = function (element) {
        element.innerHTML = '';
    };

    exports.createTextNode = function (textContent, element) {
        const doc = element ? element.ownerDocument : document;
        return doc.createTextNode(textContent);
    };

    exports.createFragment = function (element) {
        const doc = element ? element.ownerDocument : document;
        return doc.createDocumentFragment();
    };

    exports.hasCssClass = function (el, name) {
        const classes = (`${el.className}`).split(/\s+/g);
        return classes.indexOf(name) !== -1;
    };

    /*
* Add a CSS class to the list of classes on the given node
*/
    exports.addCssClass = function (el, name) {
        if (!exports.hasCssClass(el, name)) {
            el.className += ` ${name}`;
        }
    };

    /*
* Remove a CSS class from the list of classes on the given node
*/
    exports.removeCssClass = function (el, name) {
        const classes = el.className.split(/\s+/g);
        while (true) {
            const index = classes.indexOf(name);
            if (index == -1) {
                break;
            }
            classes.splice(index, 1);
        }
        el.className = classes.join(' ');
    };

    exports.toggleCssClass = function (el, name) {
        const classes = el.className.split(/\s+/g); let
            add = true;
        while (true) {
            const index = classes.indexOf(name);
            if (index == -1) {
                break;
            }
            add = false;
            classes.splice(index, 1);
        }
        if (add) classes.push(name);

        el.className = classes.join(' ');
        return add;
    };


    /*
 * Add or remove a CSS class from the list of classes on the given node
 * depending on the value of <tt>include</tt>
 */
    exports.setCssClass = function (node, className, include) {
        if (include) {
            exports.addCssClass(node, className);
        } else {
            exports.removeCssClass(node, className);
        }
    };

    exports.hasCssString = function (id, doc) {
        let index = 0; let
            sheets;
        doc = doc || document;
        if ((sheets = doc.querySelectorAll('style'))) {
            while (index < sheets.length) if (sheets[index++].id === id) return true;
        }
    };

    exports.importCssString = function importCssString(cssText, id, target) {
        let container = target;
        if (!target || !target.getRootNode) {
            container = document;
        } else {
            container = target.getRootNode();
            if (!container || container == target) container = document;
        }

        const doc = container.ownerDocument || container;

        // If style is already imported return immediately.
        if (id && exports.hasCssString(id, container)) return null;

        if (id) cssText += `\n/*# sourceURL=ace/css/${id} */`;

        const style = exports.createElement('style');
        style.appendChild(doc.createTextNode(cssText));
        if (id) style.id = id;

        if (container == doc) container = exports.getDocumentHead(doc);
        container.insertBefore(style, container.firstChild);
    };

    exports.importCssStylsheet = function (uri, doc) {
        exports.buildDom(['link', { rel: 'stylesheet', href: uri }], exports.getDocumentHead(doc));
    };
    exports.scrollbarWidth = function (document) {
        const inner = exports.createElement('ace_inner');
        inner.style.width = '100%';
        inner.style.minWidth = '0px';
        inner.style.height = '200px';
        inner.style.display = 'block';

        const outer = exports.createElement('ace_outer');
        const { style } = outer;

        style.position = 'absolute';
        style.left = '-10000px';
        style.overflow = 'hidden';
        style.width = '200px';
        style.minWidth = '0px';
        style.height = '150px';
        style.display = 'block';

        outer.appendChild(inner);

        const body = document.documentElement;
        body.appendChild(outer);

        const noScrollbar = inner.offsetWidth;

        style.overflow = 'scroll';
        let withScrollbar = inner.offsetWidth;

        if (noScrollbar == withScrollbar) {
            withScrollbar = outer.clientWidth;
        }

        body.removeChild(outer);

        return noScrollbar - withScrollbar;
    };

    if (typeof document === 'undefined') {
        exports.importCssString = function () {};
    }

    exports.computedStyle = function (element, style) {
        return window.getComputedStyle(element, '') || {};
    };

    exports.setStyle = function (styles, property, value) {
        if (styles[property] !== value) {
        // console.log("set style", property, styles[property], value);
            styles[property] = value;
        }
    };

    exports.HAS_CSS_ANIMATION = false;
    exports.HAS_CSS_TRANSFORMS = false;
    exports.HI_DPI = useragent.isWin
        ? typeof window !== 'undefined' && window.devicePixelRatio >= 1.5
        : true;

    if (typeof document !== 'undefined') {
    // detect CSS transformation support
        let div = document.createElement('div');
        if (exports.HI_DPI && div.style.transform !== undefined) exports.HAS_CSS_TRANSFORMS = true;
        if (!useragent.isEdge && typeof div.style.animationName !== 'undefined') exports.HAS_CSS_ANIMATION = true;
        div = null;
    }

    if (exports.HAS_CSS_TRANSFORMS) {
        exports.translate = function (element, tx, ty) {
            element.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
        };
    } else {
        exports.translate = function (element, tx, ty) {
            element.style.top = `${Math.round(ty)}px`;
            element.style.left = `${Math.round(tx)}px`;
        };
    }
});
