// JSDoc parser

// Parses a subset of JSDoc-style comments in order to include the
// explicitly defined types in the analysis.

(function (mod) {
    if (typeof exports === 'object' && typeof module === 'object') // CommonJS
    { return exports.init = mod; }
    if (typeof define === 'function' && define.amd) // AMD
    { return define({ init: mod }); }
    tern.jsdoc = { init: mod }; // Plain browser env
}((exports, infer) => {
    function skipSpace(str, pos) {
        while (/\s/.test(str.charAt(pos))) ++pos;
        return pos;
    }

    function parseLabelList(scope, str, pos, close) {
        const labels = []; const
            types = [];
        for (let first = true; ; first = false) {
            pos = skipSpace(str, pos);
            if (first && str.charAt(pos) == close) break;
            const colon = str.indexOf(':', pos);
            if (colon < 0) return null;
            const label = str.slice(pos, colon);
            if (!/^[\w$]+$/.test(label)) return null;
            labels.push(label);
            pos = colon + 1;
            const type = parseType(scope, str, pos);
            if (!type) return null;
            pos = type.end;
            types.push(type.type);
            pos = skipSpace(str, pos);
            const next = str.charAt(pos);
            ++pos;
            if (next == close) break;
            if (next != ',') return null;
        }
        return { labels, types, end: pos };
    }

    function parseType(scope, str, pos) {
        pos = skipSpace(str, pos);
        let type;

        if (str.indexOf('function(', pos) == pos) {
            const args = parseLabelList(scope, str, pos + 9, ')'); let
                ret = infer.ANull;
            if (!args) return null;
            pos = skipSpace(str, args.end);
            if (str.charAt(pos) == ':') {
                ++pos;
                const retType = parseType(scope, str, pos + 1);
                if (!retType) return null;
                pos = retType.end;
                ret = retType.type;
            }
            type = new infer.Fn(null, infer.ANull, args.labels, args.types, ret);
        } else if (str.charAt(pos) == '[') {
            const inner = parseType(scope, str, pos + 1);
            if (!inner) return null;
            pos = skipSpace(str, inner.end);
            if (str.charAt(pos) != ']') return null;
            ++pos;
            type = new infer.Arr(inner.type);
        } else if (str.charAt(pos) == '{') {
            const fields = parseLabelList(scope, str, pos + 1, '}');
            if (!fields) return null;
            type = new infer.Obj(true);
            for (let i = 0; i < fields.types.length; ++i) {
                const field = type.defProp(fields.labels[i]);
                field.initializer = true;
                fields.types[i].propagate(field);
            }
            pos = fields.end;
        } else {
            const start = pos;
            while (/[\w$]/.test(str.charAt(pos))) ++pos;
            if (start == pos) return null;
            const word = str.slice(start, pos);
            if (/^(number|integer)$/i.test(word)) type = infer.cx().num;
            else if (/^bool(ean)?$/i.test(word)) type = infer.cx().bool;
            else if (/^string$/i.test(word)) type = infer.cx().str;
            else {
                let found = scope.hasProp(word);
                if (found) found = found.getType();
                if (!found) {
                    type = infer.ANull;
                } else if (found instanceof infer.Fn && /^[A-Z]/.test(word)) {
                    const proto = found.getProp('prototype').getType();
                    if (proto instanceof infer.Obj) type = infer.getInstance(proto);
                } else {
                    type = found;
                }
            }
        }
        return { type, end: pos };
    }

    function parseTypeOuter(scope, str, pos) {
        pos = skipSpace(str, pos || 0);
        if (str.charAt(pos) != '{') return null;
        const result = parseType(scope, str, pos + 1);
        if (!result || str.charAt(result.end) != '}') return null;
        ++result.end;
        return result;
    }

    exports.interpretComments = function (node, scope, aval, comment) {
        let type; let args; let ret; let
            foundOne;

        const decl = /(?:\n|$|\*)\s*@(type|param|arg(?:ument)?|returns?)\s+(.*)/g; let
            m;
        while (m = decl.exec(comment)) {
            const parsed = parseTypeOuter(scope, m[2]);
            if (!parsed) continue;
            foundOne = true;

            switch (m[1]) {
            case 'returns': case 'return':
                ret = parsed.type; break;
            case 'type':
                type = parsed.type; break;
            case 'param': case 'arg': case 'argument':
                var name = m[2].slice(parsed.end).match(/^\s*([\w$]+)/);
                if (!name) continue;
                (args || (args = {}))[name[1]] = parsed.type;
                break;
            }
        }

        if (foundOne) applyType(type, args, ret, node, aval);
    };

    function applyType(type, args, ret, node, aval) {
        let fn;
        if (node.type == 'VariableDeclaration') {
            const decl = node.declarations[0];
            if (decl.init && decl.init.type == 'FunctionExpression') fn = decl.init.body.scope.fnType;
        } else if (node.type == 'FunctionDeclaration') {
            fn = node.body.scope.fnType;
        } else { // An object property
            if (node.value.type == 'FunctionExpression') fn = node.value.body.scope.fnType;
        }

        if (fn && (args || ret)) {
            if (args) {
                for (let i = 0; i < fn.argNames.length; ++i) {
                    const name = fn.argNames[i]; const
                        known = args[name];
                    if (known) known.propagate(fn.args[i]);
                }
            }
            if (ret) ret.propagate(fn.retval);
        } else if (type) {
            type.propagate(aval);
        }
    }

    return exports;
}));
