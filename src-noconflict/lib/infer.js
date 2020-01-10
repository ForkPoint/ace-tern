// Main type inference engine

// Walks an AST, building up a graph of abstract values and contraints
// that cause types to flow from one node to another. Also defines a
// number of utilities for accessing ASTs and scopes.

// Analysis is done in a context, which is tracked by the dynamically
// bound cx variable. Use withContext to set the current context.

// For memory-saving reasons, individual types export an interface
// similar to abstract values (which can hold multiple types), and can
// thus be used in place abstract values that only ever contain a
// single type.

(function (mod) {
    if (typeof exports === 'object' && typeof module === 'object') // CommonJS
    {
        return mod(exports, require('../acorn/dist/acorn'), require('../acorn/dist/acorn_loose'), require('../acorn/dist/walk'),
            require('./def'), require('./jsdoc'));
    }
    if (typeof define === 'function' && define.amd) // AMD
    { return define(['exports', '../acorn/dist/acorn', '../acorn/dist/acorn_loose', '../acorn/dist/walk', './def', './jsdoc'], mod); }
    mod(self.tern || (self.tern = {}), acorn, acorn, acorn.walk, tern.def, tern.jsdoc); // Plain browser env
}((exports, acorn, acorn_loose, walk, def, jsdoc) => {
    // Delayed initialization because of cyclic dependencies.
    def = exports.def = def.init({}, exports);
    jsdoc = exports.jsdoc = jsdoc.init({}, exports);

    const toString = exports.toString = function (type, maxDepth, parent) {
        return !type || type == parent ? '?' : type.toString(maxDepth);
    };

    // A variant of AVal used for unknown, dead-end values. Also serves
    // as prototype for AVals, Types, and Constraints because it
    // implements 'empty' versions of all the methods that the code
    // expects.
    var ANull = exports.ANull = {
        addType() {},
        propagate() {},
        getProp() { return ANull; },
        forAllProps() {},
        hasType() { return false; },
        isEmpty() { return true; },
        getFunctionType() {},
        getType() {},
        gatherProperties() {},
        propagatesTo() {},
        typeHint() {},
        propHint() {},
    };

    function extend(proto, props) {
        const obj = Object.create(proto);
        if (props) for (const prop in props) obj[prop] = props[prop];
        return obj;
    }

    // ABSTRACT VALUES

    const WG_DEFAULT = 100; const WG_MADEUP_PROTO = 10; const WG_MULTI_MEMBER = 5; const
        WG_GLOBAL_THIS = 2;

    const AVal = exports.AVal = function () {
        this.types = [];
        this.forward = null;
        this.maxWeight = 0;
    };
    AVal.prototype = extend(ANull, {
        addType(type, weight) {
            weight = weight || WG_DEFAULT;
            if (this.maxWeight < weight) {
                this.types.length = 0;
                this.maxWeight = weight;
            } else if (this.maxWeight > weight || this.types.indexOf(type) > -1) {
                return;
            }

            this.types.push(type);
            const { forward } = this;
            if (forward) {
                withWorklist((add) => {
                    for (let i = 0; i < forward.length; ++i) add(type, forward[i], weight);
                });
            }
        },

        propagate(target, weight) {
            if (target == ANull || (target instanceof Type)) return;
            if (weight && weight < WG_DEFAULT) target = new Muffle(target, weight);
            (this.forward || (this.forward = [])).push(target);
            const { types } = this;
            var weight = this.maxWeight;
            if (types.length) {
                withWorklist((add) => {
                    for (let i = 0; i < types.length; ++i) add(types[i], target, weight);
                });
            }
        },

        getProp(prop) {
            if (prop == '__proto__' || prop == '✖') return ANull;
            let found = (this.props || (this.props = Object.create(null)))[prop];
            if (!found) {
                found = this.props[prop] = new AVal();
                this.propagate(new PropIsSubset(prop, found));
            }
            return found;
        },

        forAllProps(c) {
            this.propagate(new ForAllProps(c));
        },

        hasType(type) {
            return this.types.indexOf(type) > -1;
        },
        isEmpty() { return this.types.length == 0; },
        getFunctionType() {
            for (let i = this.types.length - 1; i >= 0; --i) if (this.types[i] instanceof Fn) return this.types[i];
        },

        getType(guess) {
            if (this.types.length == 0 && guess !== false) return this.makeupType();
            if (this.types.length == 1) return this.types[0];
            return canonicalType(this.types);
        },

        makeupType() {
            if (!this.forward) return null;
            for (var i = this.forward.length - 1; i >= 0; --i) {
                const hint = this.forward[i].typeHint();
                if (hint && !hint.isEmpty()) { guessing = true; return hint; }
            }

            const props = Object.create(null); let
                foundProp = null;
            for (var i = 0; i < this.forward.length; ++i) {
                var prop = this.forward[i].propHint();
                if (prop && prop != 'length' && prop != '<i>' && prop != '✖') {
                    props[prop] = true;
                    foundProp = prop;
                }
            }
            if (!foundProp) return null;

            const objs = objsWithProp(foundProp);
            if (objs) {
                const matches = [];
                search: for (var i = 0; i < objs.length; ++i) {
                    let obj = objs[i];
                    for (var prop in props) if (!obj.hasProp(prop)) continue search;
                    if (obj.hasCtor) obj = getInstance(obj);
                    matches.push(obj);
                }
                const canon = canonicalType(matches);
                if (canon) { guessing = true; return canon; }
            }
        },

        typeHint() { return this.types.length ? this.getType() : null; },
        propagatesTo() { return this; },

        gatherProperties(f, depth) {
            for (let i = 0; i < this.types.length; ++i) this.types[i].gatherProperties(f, depth);
        },

        guessProperties(f) {
            if (this.forward) {
                for (let i = 0; i < this.forward.length; ++i) {
                    const prop = this.forward[i].propHint();
                    if (prop) f(prop, null, 0);
                }
            }
        },
    });

    function canonicalType(types) {
        let arrays = 0; let fns = 0; let objs = 0; let
            prim = null;
        for (var i = 0; i < types.length; ++i) {
            var tp = types[i];
            if (tp instanceof Arr) ++arrays;
            else if (tp instanceof Fn) ++fns;
            else if (tp instanceof Obj) ++objs;
            else if (tp instanceof Prim) {
                if (prim && tp.name != prim.name) return null;
                prim = tp;
            }
        }
        const kinds = (arrays && 1) + (fns && 1) + (objs && 1) + (prim && 1);
        if (kinds > 1) return null;
        if (prim) return prim;

        let maxScore = 0; let
            maxTp = null;
        for (var i = 0; i < types.length; ++i) {
            var tp = types[i]; let
                score = 0;
            if (arrays) {
                score = tp.getProp('<i>').isEmpty() ? 1 : 2;
            } else if (fns) {
                score = 1;
                for (let j = 0; j < tp.args.length; ++j) if (!tp.args[j].isEmpty()) ++score;
                if (!tp.retval.isEmpty()) ++score;
            } else if (objs) {
                score = tp.name ? 100 : 2;
            } else if (prims) {
                score = 1;
            }
            if (score >= maxScore) { maxScore = score; maxTp = tp; }
        }
        return maxTp;
    }

    // PROPAGATION STRATEGIES

    function Constraint() {}
    Constraint.prototype = extend(ANull, {
        init() { this.origin = cx.curOrigin; },
    });

    const constraint = exports.constraint = function (props, methods) {
        let body = 'this.init();';
        props = props ? props.split(', ') : [];
        for (let i = 0; i < props.length; ++i) body += `this.${props[i]} = ${props[i]};`;
        const ctor = Function.apply(null, props.concat([body]));
        ctor.prototype = Object.create(Constraint.prototype);
        for (const m in methods) if (methods.hasOwnProperty(m)) ctor.prototype[m] = methods[m];
        return ctor;
    };

    var PropIsSubset = constraint('prop, target', {
        addType(type, weight) {
            if (type.getProp) type.getProp(this.prop).propagate(this.target, weight);
        },
        propHint() { return this.prop; },
        propagatesTo() {
            return { target: this.target, pathExt: `.${this.prop}` };
        },
    });

    const PropHasSubset = exports.PropHasSubset = constraint('prop, target, originNode', {
        addType(type, weight) {
            if (!(type instanceof Obj)) return;
            const prop = type.defProp(this.prop, this.originNode);
            prop.origin = this.origin;
            this.target.propagate(prop, weight);
        },
        propHint() { return this.prop; },
    });

    var ForAllProps = constraint('c', {
        addType(type) {
            if (!(type instanceof Obj)) return;
            type.forAllProps(this.c);
        },
    });

    const IsCallee = exports.IsCallee = constraint('self, args, argNodes, retval', {
        addType(fn, weight) {
            if (!(fn instanceof Fn)) return;
            for (let i = 0; i < this.args.length; ++i) {
                if (i < fn.args.length) this.args[i].propagate(fn.args[i], weight);
                if (fn.arguments) this.args[i].propagate(fn.arguments, weight);
            }
            this.self.propagate(fn.self, this.self == cx.topScope ? WG_GLOBAL_THIS : weight);
            if (!fn.computeRet) fn.retval.propagate(this.retval, weight);
            else fn.computeRet(this.self, this.args, this.argNodes).propagate(this.retval, weight);
        },
        typeHint() {
            const names = [];
            for (let i = 0; i < this.args.length; ++i) names.push('?');
            return new Fn(null, this.self, this.args, names, ANull);
        },
        propagatesTo() {
            return { target: this.retval, pathExt: '.!ret' };
        },
    });

    const HasMethodCall = constraint('propName, args, argNodes, retval', {
        addType(obj, weight) {
            obj.getProp(this.propName).propagate(new IsCallee(obj, this.args, this.argNodes, this.retval), weight);
        },
        propHint() { return this.propName; },
    });

    const IsCtor = constraint('target', {
        addType(f, weight) {
            if (!(f instanceof Fn)) return;
            f.getProp('prototype').propagate(new IsProto(f, this.target), weight);
        },
    });

    var getInstance = exports.getInstance = function (obj, ctor) {
        if (!ctor) ctor = obj.hasCtor;
        if (!obj.instances) obj.instances = [];
        for (let i = 0; i < obj.instances.length; ++i) {
            const cur = obj.instances[i];
            if (cur.ctor == ctor) return cur.instance;
        }
        const instance = new Obj(obj, ctor && ctor.name);
        instance.origin = obj.origin;
        obj.instances.push({ ctor, instance });
        return instance;
    };

    var IsProto = constraint('ctor, target', {
        addType(o, weight) {
            if (!(o instanceof Obj)) return;
            if (o == cx.protos.Array) this.target.addType(new Arr());
            else this.target.addType(getInstance(o, this.ctor));
        },
    });

    const FnPrototype = constraint('fn', {
        addType(o, weight) {
            if (o instanceof Obj && !o.hasCtor) o.hasCtor = this.fn;
        },
    });

    const IsAdded = constraint('other, target', {
        addType(type, weight) {
            if (type == cx.str) this.target.addType(cx.str, weight);
            else if (type == cx.num && this.other.hasType(cx.num)) this.target.addType(cx.num, weight);
        },
        typeHint() { return this.other; },
    });

    const IfObj = constraint('target', {
        addType(t, weight) {
            if (t instanceof Obj) this.target.addType(t, weight);
        },
        propagatesTo() { return this.target; },
    });

    const AutoInstance = constraint('target', {
        addType(tp, weight) {
            if (tp instanceof Obj && tp.name && /\.prototype$/.test(tp.name)) getInstance(tp).propagate(this.target, weight);
        },
        propagatesTo() { return this.target; },
    });

    var Muffle = constraint('inner, weight', {
        addType(tp, weight) {
            this.inner.addType(tp, Math.min(weight, this.weight));
        },
        propagatesTo() { return this.inner.propagatesTo(); },
        typeHint() { return this.inner.typeHint(); },
        propHint() { return this.inner.propHint(); },
    });

    // TYPE OBJECTS

    var Type = exports.Type = function () {};
    Type.prototype = extend(ANull, {
        propagate(c, w) { c.addType(this, w); },
        hasType(other) { return other == this; },
        isEmpty() { return false; },
        typeHint() { return this; },
        getType() { return this; },
    });

    var Prim = exports.Prim = function (proto, name) { this.name = name; this.proto = proto; };
    Prim.prototype = extend(Type.prototype, {
        toString() { return this.name; },
        getProp(prop) { return this.proto.hasProp(prop) || ANull; },
        gatherProperties(f, depth) {
            if (this.proto) this.proto.gatherProperties(f, depth);
        },
    });

    var Obj = exports.Obj = function (proto, name) {
        if (!this.props) this.props = Object.create(null);
        this.proto = proto === true ? cx.protos.Object : proto;
        if (proto && !name && proto.name && !(this instanceof Fn)) {
            const match = /^(.*)\.prototype$/.exec(this.proto.name);
            if (match) name = match[1];
        }
        this.name = name;
        this.maybeProps = null;
        this.origin = cx.curOrigin;
    };
    Obj.prototype = extend(Type.prototype, {
        toString(maxDepth) {
            if (!maxDepth && this.name) return this.name;
            const props = []; let
                etc = false;
            for (const prop in this.props) {
                if (prop != '<i>') {
                    if (props.length > 5) { etc = true; break; }
                    if (maxDepth) props.push(`${prop}: ${toString(this.props[prop].getType(), maxDepth - 1)}`);
                    else props.push(prop);
                }
            }
            props.sort();
            if (etc) props.push('...');
            return `{${props.join(', ')}}`;
        },
        hasProp(prop, searchProto) {
            let found = this.props[prop];
            if (searchProto !== false) for (let p = this.proto; p && !found; p = p.proto) found = p.props[prop];
            return found;
        },
        defProp(prop, originNode) {
            const found = this.hasProp(prop, false);
            if (found) {
                if (originNode && !found.originNode) found.originNode = originNode;
                return found;
            }
            if (prop == '__proto__' || prop == '✖') return ANull;

            let av = this.maybeProps && this.maybeProps[prop];
            if (av) {
                delete this.maybeProps[prop];
                this.maybeUnregProtoPropHandler();
            } else {
                av = new AVal();
            }

            this.props[prop] = av;
            av.originNode = originNode;
            av.origin = cx.curOrigin;
            this.broadcastProp(prop, av, true);
            return av;
        },
        getProp(prop) {
            const found = this.hasProp(prop, true) || (this.maybeProps && this.maybeProps[prop]);
            if (found) return found;
            if (!this.maybeProps) {
                if (this.proto) this.proto.forAllProps(this);
                this.maybeProps = Object.create(null);
            }
            return this.maybeProps[prop] = new AVal();
        },
        broadcastProp(prop, val, local) {
            // If this is a scope, it shouldn't be registered
            if (local && !this.prev) registerProp(prop, this);

            if (this.onNewProp) {
                for (let i = 0; i < this.onNewProp.length; ++i) {
                    const h = this.onNewProp[i];
                    h.onProtoProp ? h.onProtoProp(prop, val, local) : h(prop, val, local);
                }
            }
        },
        onProtoProp(prop, val, local) {
            const maybe = this.maybeProps && this.maybeProps[prop];
            if (maybe) {
                delete this.maybeProps[prop];
                this.maybeUnregProtoPropHandler();
                this.proto.getProp(prop).propagate(maybe);
            }
            this.broadcastProp(prop, val, false);
        },
        forAllProps(c) {
            if (!this.onNewProp) {
                this.onNewProp = [];
                if (this.proto) this.proto.forAllProps(this);
            }
            this.onNewProp.push(c);
            for (let o = this; o; o = o.proto) {
                for (const prop in o.props) {
                    if (c.onProtoProp) c.onProtoProp(prop, o.props[prop], o == this);
                    else c(prop, o.props[prop], o == this);
                }
            }
        },
        maybeUnregProtoPropHandler() {
            if (this.maybeProps) {
                for (const _n in this.maybeProps) return;
                this.maybeProps = null;
            }
            if (!this.proto || this.onNewProp && this.onNewProp.length) return;
            this.proto.unregPropHandler(this);
        },
        unregPropHandler(handler) {
            for (let i = 0; i < this.onNewProp.length; ++i) if (this.onNewProp[i] == handler) { this.onNewProp.splice(i, 1); break; }
            this.maybeUnregProtoPropHandler();
        },
        gatherProperties(f, depth) {
            for (const prop in this.props) {
                if (prop != '<i>') f(prop, this, depth);
            }
            if (this.proto) this.proto.gatherProperties(f, depth + 1);
        },
    });

    var Fn = exports.Fn = function (name, self, args, argNames, retval) {
        Obj.call(this, cx.protos.Function, name);
        this.self = self;
        this.args = args;
        this.argNames = argNames;
        this.retval = retval;
    };
    Fn.prototype = extend(Obj.prototype, {
        toString(maxDepth) {
            if (maxDepth) maxDepth--;
            let str = 'fn(';
            for (let i = 0; i < this.args.length; ++i) {
                if (i) str += ', ';
                const name = this.argNames[i];
                if (name && name != '?') str += `${name}: `;
                str += toString(this.args[i].getType(), maxDepth, this);
            }
            str += ')';
            if (!this.retval.isEmpty()) str += ` -> ${toString(this.retval.getType(), maxDepth, this)}`;
            return str;
        },
        getProp(prop) {
            if (prop == 'prototype') {
                let known = this.hasProp(prop);
                if (!known) {
                    known = this.defProp(prop);
                    const proto = new Obj(true, this.name && `${this.name}.prototype`);
                    proto.origin = this.origin;
                    known.addType(proto, WG_MADEUP_PROTO);
                }
                return known;
            }
            return Obj.prototype.getProp.call(this, prop);
        },
        defProp(prop) {
            if (prop == 'prototype') {
                let found = this.hasProp(prop);
                if (found) return found;
                found = Obj.prototype.defProp.call(this, prop);
                found.origin = this.origin;
                found.propagate(new FnPrototype(this));
                return found;
            }
            return Obj.prototype.defProp.call(this, prop);
        },
        getFunctionType() { return this; },
    });

    var Arr = exports.Arr = function (contentType) {
        Obj.call(this, cx.protos.Array);
        const content = this.defProp('<i>');
        if (contentType) contentType.propagate(content);
    };
    Arr.prototype = extend(Obj.prototype, {
        toString(maxDepth) {
            return `[${toString(this.getProp('<i>').getType(), maxDepth, this)}]`;
        },
    });

    // THE PROPERTY REGISTRY

    function registerProp(prop, obj) {
        const data = cx.props[prop] || (cx.props[prop] = []);
        data.push(obj);
    }

    function objsWithProp(prop) {
        return cx.props[prop];
    }

    // INFERENCE CONTEXT

    const Context = exports.Context = function (defs, parent) {
        this.parent = parent;
        this.props = Object.create(null);
        this.protos = Object.create(null);
        this.prim = Object.create(null);
        this.origins = [];
        this.curOrigin = 'ecma5';
        this.paths = Object.create(null);
        this.purgeGen = 0;
        this.workList = null;

        exports.withContext(this, () => {
            cx.protos.Object = new Obj(null, 'Object.prototype');
            cx.topScope = new Scope();
            cx.topScope.name = '<top>';
            cx.protos.Array = new Obj(true, 'Array.prototype');
            cx.protos.Function = new Obj(true, 'Function.prototype');
            cx.protos.RegExp = new Obj(true, 'RegExp.prototype');
            cx.protos.String = new Obj(true, 'String.prototype');
            cx.protos.Number = new Obj(true, 'Number.prototype');
            cx.protos.Boolean = new Obj(true, 'Boolean.prototype');
            cx.str = new Prim(cx.protos.String, 'string');
            cx.bool = new Prim(cx.protos.Boolean, 'bool');
            cx.num = new Prim(cx.protos.Number, 'number');
            cx.curOrigin = null;

            if (defs) {
                for (let i = 0; i < defs.length; ++i) def.load(defs[i]);
            }
        });
    };

    var cx = null;
    exports.cx = function () { return cx; };

    exports.withContext = function (context, f) {
        const old = cx;
        cx = context;
        try { return f(); } finally { cx = old; }
    };

    exports.addOrigin = function (origin) {
        if (cx.origins.indexOf(origin) < 0) cx.origins.push(origin);
    };

    const baseMaxWorkDepth = 20; const
        reduceMaxWorkDepth = 0.0001;
    function withWorklist(f) {
        if (cx.workList) return f(cx.workList);

        const list = []; let
            depth = 0;
        const add = cx.workList = function (type, target, weight) {
            if (depth < baseMaxWorkDepth - reduceMaxWorkDepth * list.length) list.push(type, target, weight, depth);
        };
        try {
            const ret = f(add);
            for (let i = 0; i < list.length; i += 4) {
                depth = list[i + 3] + 1;
                list[i + 1].addType(list[i], list[i + 2]);
            }
            return ret;
        } finally {
            cx.workList = null;
        }
    }

    // SCOPES

    var Scope = exports.Scope = function (prev) {
        Obj.call(this, prev || true);
        this.prev = prev;
    };
    Scope.prototype = extend(Obj.prototype, {
        defVar(name, originNode) {
            for (let s = this; ; s = s.proto) {
                const found = s.props[name];
                if (found) return found;
                if (!s.prev) return s.defProp(name, originNode);
            }
        },
    });

    // RETVAL COMPUTATION HEURISTICS

    function maybeInstantiate(scope, score) {
        if (scope.fnType) scope.fnType.instantiateScore = (scope.fnType.instantiateScore || 0) + score;
    }

    function maybeTagAsInstantiated(node, scope) {
        const score = scope.fnType.instantiateScore;
        if (score && score / (node.end - node.start) > 0.01) {
            maybeInstantiate(scope.prev, score / 2);
            setFunctionInstantiated(node, scope);
            return true;
        }
    }

    function setFunctionInstantiated(node, scope) {
        const fn = scope.fnType;
        // Disconnect the arg avals, so that we can add info to them without side effects
        for (let i = 0; i < fn.args.length; ++i) fn.args[i] = new AVal();
        fn.self = new AVal();
        var computeRet = fn.computeRet = function (self, args) {
            // Prevent recursion
            this.computeRet = null;
            const oldOrigin = cx.curOrigin;
            cx.curOrigin = fn.origin;
            const scopeCopy = new Scope(scope.prev);
            for (const v in scope.props) {
                const local = scopeCopy.defProp(v);
                for (var i = 0; i < args.length; ++i) { if (fn.argNames[i] == v && i < args.length) args[i].propagate(local); }
            }
            scopeCopy.fnType = new Fn(fn.name, self, args, fn.argNames, ANull);
            if (fn.arguments) {
                const argset = scopeCopy.fnType.arguments = new AVal();
                scopeCopy.defProp('arguments').addType(new Arr(argset));
                for (var i = 0; i < args.length; ++i) args[i].propagate(argset);
            }
            node.body.scope = scopeCopy;
            walk.recursive(node.body, scopeCopy, null, scopeGatherer);
            walk.recursive(node.body, scopeCopy, null, inferWrapper);
            this.computeRet = computeRet;
            cx.curOrigin = oldOrigin;
            return scopeCopy.fnType.retval;
        };
    }

    function maybeTagAsGeneric(node, scope) {
        const fn = scope.fnType; let
            target = fn.retval;
        if (target == ANull) return;
        let targetInner; let
            asArray;
        if (!target.isEmpty() && (targetInner = target.getType()) instanceof Arr) target = asArray = targetInner.getProp('<i>');

        function explore(aval, path, depth) {
            if (depth > 3 || !aval.forward) return;
            for (let i = 0; i < aval.forward.length; ++i) {
                const prop = aval.forward[i].propagatesTo();
                if (!prop) continue;
                let newPath = path; var
                    dest;
                if (prop instanceof AVal) {
                    dest = prop;
                } else if (prop.target instanceof AVal) {
                    newPath += prop.pathExt;
                    dest = prop.target;
                } else continue;
                if (dest == target) return newPath;
                const found = explore(dest, newPath, depth + 1);
                if (found) return found;
            }
        }

        let foundPath = explore(fn.self, '!this', 0);
        for (let i = 0; !foundPath && i < fn.args.length; ++i) foundPath = explore(fn.args[i], `!${i}`, 0);

        if (foundPath) {
            if (asArray) foundPath = `[${foundPath}]`;
            const p = new def.TypeParser(foundPath);
            fn.computeRet = p.parseRetType();
            fn.computeRetSource = foundPath;
            return true;
        }
    }

    // SCOPE GATHERING PASS

    function addVar(scope, nameNode) {
        const val = scope.defProp(nameNode.name, nameNode);
        if (val.maybePurge) val.maybePurge = false;
        return val;
    }

    var scopeGatherer = walk.make({
        Function(node, scope, c) {
            const inner = node.body.scope = new Scope(scope);
            inner.node = node;
            const argVals = []; const
                argNames = [];
            for (let i = 0; i < node.params.length; ++i) {
                const param = node.params[i];
                argNames.push(param.name);
                argVals.push(addVar(inner, param));
            }
            inner.fnType = new Fn(node.id && node.id.name, new AVal(), argVals, argNames, ANull);
            inner.fnType.originNode = node;
            if (node.id) {
                const decl = node.type == 'FunctionDeclaration';
                addVar(decl ? scope : inner, node.id);
            }
            c(node.body, inner, 'ScopeBody');
        },
        TryStatement(node, scope, c) {
            c(node.block, scope, 'Statement');
            if (node.handler) {
                const { name } = node.handler.param;
                addVar(scope, node.handler.param);
                c(node.handler.body, scope, 'ScopeBody');
            }
            if (node.finalizer) c(node.finalizer, scope, 'Statement');
        },
        VariableDeclaration(node, scope, c) {
            for (let i = 0; i < node.declarations.length; ++i) {
                const decl = node.declarations[i];
                addVar(scope, decl.id);
                if (decl.init) c(decl.init, scope, 'Expression');
            }
        },
    });

    // CONSTRAINT GATHERING PASS

    function propName(node, scope, c) {
        const prop = node.property;
        if (!node.computed) return prop.name;
        if (prop.type == 'Literal' && typeof prop.value === 'string') return prop.value;
        if (c) infer(prop, scope, c, ANull);
        return '<i>';
    }

    function lvalName(node) {
        if (node.type == 'Identifier') return node.name;
        if (node.type == 'MemberExpression' && !node.computed) {
            if (node.object.type != 'Identifier') return node.property.name;
            return `${node.object.name}.${node.property.name}`;
        }
    }

    function maybeMethod(node, obj) {
        if (node.type != 'FunctionExpression') return;
        obj.propagate(new AutoInstance(node.body.scope.fnType.self), 2);
    }

    function unopResultType(op) {
        switch (op) {
        case '+': case '-': case '~': return cx.num;
        case '!': return cx.bool;
        case 'typeof': return cx.str;
        case 'void': case 'delete': return ANull;
        }
    }
    function binopIsBoolean(op) {
        switch (op) {
        case '==': case '!=': case '===': case '!==': case '<': case '>': case '>=': case '<=':
        case 'in': case 'instanceof': return true;
        }
    }
    function literalType(val) {
        switch (typeof val) {
        case 'boolean': return cx.bool;
        case 'number': return cx.num;
        case 'string': return cx.str;
        case 'object':
            if (!val) return ANull;
            return getInstance(cx.protos.RegExp);
        }
    }

    function ret(f) {
        return function (node, scope, c, out, name) {
            const r = f(node, scope, c, name);
            if (out) r.propagate(out);
            return r;
        };
    }
    function fill(f) {
        return function (node, scope, c, out, name) {
            if (!out) out = new AVal();
            f(node, scope, c, out, name);
            return out;
        };
    }

    const inferExprVisitor = {
        ArrayExpression: ret((node, scope, c) => {
            const eltval = new AVal();
            for (let i = 0; i < node.elements.length; ++i) {
                const elt = node.elements[i];
                if (elt) infer(elt, scope, c, eltval);
            }
            return new Arr(eltval);
        }),
        ObjectExpression: ret((node, scope, c, name) => {
            const obj = node.objType = new Obj(true, name);
            obj.originNode = node;

            for (let i = 0; i < node.properties.length; ++i) {
                const prop = node.properties[i]; const { key } = prop; var
                    name;
                if (key.type == 'Identifier') {
                    name = key.name;
                } else if (typeof key.value === 'string') {
                    name = key.value;
                } else {
                    infer(prop.value, scope, c, ANull);
                    continue;
                }
                const val = obj.defProp(name, key);
                val.initializer = true;
                infer(prop.value, scope, c, val, name);
                interpretComments(prop, prop.key.comments, scope, val);
                maybeMethod(prop.value, obj);
            }
            return obj;
        }),
        FunctionExpression: ret((node, scope, c, name) => {
            const inner = node.body.scope; const
                fn = inner.fnType;
            if (name && !fn.name) fn.name = name;
            c(node.body, scope, 'ScopeBody');
            maybeTagAsInstantiated(node, inner) || maybeTagAsGeneric(node, inner);
            if (node.id) inner.getProp(node.id.name).addType(fn);
            return fn;
        }),
        SequenceExpression: ret((node, scope, c) => {
            for (var i = 0, l = node.expressions.length - 1; i < l; ++i) infer(node.expressions[i], scope, c, ANull);
            return infer(node.expressions[l], scope, c);
        }),
        UnaryExpression: ret((node, scope, c) => {
            infer(node.argument, scope, c, ANull);
            return unopResultType(node.operator);
        }),
        UpdateExpression: ret((node, scope, c) => {
            infer(node.argument, scope, c, ANull);
            return cx.num;
        }),
        BinaryExpression: ret((node, scope, c) => {
            if (node.operator == '+') {
                const lhs = infer(node.left, scope, c);
                const rhs = infer(node.right, scope, c);
                if (lhs.hasType(cx.str) || rhs.hasType(cx.str)) return cx.str;
                if (lhs.hasType(cx.num) && rhs.hasType(cx.num)) return cx.num;
                const result = new AVal();
                lhs.propagate(new IsAdded(rhs, result));
                rhs.propagate(new IsAdded(lhs, result));
                return result;
            }
            infer(node.left, scope, c, ANull);
            infer(node.right, scope, c, ANull);
            return binopIsBoolean(node.operator) ? cx.bool : cx.num;
        }),
        AssignmentExpression: ret((node, scope, c) => {
            let rhs; let name; let
                pName;
            if (node.left.type == 'MemberExpression') {
                pName = propName(node.left, scope, c);
                if (node.left.object.type == 'Identifier') name = `${node.left.object.name}.${pName}`;
            } else {
                name = node.left.name;
            }

            if (node.operator != '=' && node.operator != '+=') {
                infer(node.right, scope, c, ANull);
                rhs = cx.num;
            } else {
                rhs = infer(node.right, scope, c, null, name);
            }

            if (node.left.type == 'MemberExpression') {
                const obj = infer(node.left.object, scope, c);
                if (!obj.hasType(cx.topScope)) maybeMethod(node.right, obj);
                if (pName == 'prototype') maybeInstantiate(scope, 20);
                if (pName == '<i>') {
                    // This is a hack to recognize for/in loops that copy
                    // properties, and do the copying ourselves, insofar as we
                    // manage, because such loops tend to be relevant for type
                    // information.
                    var v = node.left.property.name; const local = scope.props[v]; const
                        over = local && local.iteratesOver;
                    if (over) {
                        maybeInstantiate(scope, 20);
                        const fromRight = node.right.type == 'MemberExpression' && node.right.computed && node.right.property.name == v;
                        over.forAllProps((prop, val, local) => {
                            if (local && prop != 'prototype' && prop != '<i>') obj.propagate(new PropHasSubset(prop, fromRight ? val : ANull));
                        });
                        return rhs;
                    }
                }
                obj.propagate(new PropHasSubset(pName, rhs, node.left.property));
            } else { // Identifier
                var v = scope.defVar(node.left.name, node);
                if (v.maybePurge) v.maybePurge = false;
                rhs.propagate(v);
            }
            return rhs;
        }),
        LogicalExpression: fill((node, scope, c, out) => {
            infer(node.left, scope, c, out);
            infer(node.right, scope, c, out);
        }),
        ConditionalExpression: fill((node, scope, c, out) => {
            infer(node.test, scope, c, ANull);
            infer(node.consequent, scope, c, out);
            infer(node.alternate, scope, c, out);
        }),
        NewExpression: fill((node, scope, c, out) => {
            if (node.callee.type == 'Identifier' && node.callee.name in scope.props) maybeInstantiate(scope, 20);

            for (var i = 0, args = []; i < node.arguments.length; ++i) args.push(infer(node.arguments[i], scope, c));
            const callee = infer(node.callee, scope, c);
            const self = new AVal();
            self.propagate(out);
            callee.propagate(new IsCtor(self));
            callee.propagate(new IsCallee(self, args, node.arguments, new IfObj(out)));
        }),
        CallExpression: fill((node, scope, c, out) => {
            for (var i = 0, args = []; i < node.arguments.length; ++i) args.push(infer(node.arguments[i], scope, c));
            if (node.callee.type == 'MemberExpression') {
                const self = infer(node.callee.object, scope, c);
                const pName = propName(node.callee, scope, c);
                if ((pName == 'call' || pName == 'apply')
            && scope.fnType && scope.fnType.args.indexOf(self) > -1) maybeInstantiate(scope, 30);
                self.propagate(new HasMethodCall(pName, args, node.arguments, out));
            } else {
                const callee = infer(node.callee, scope, c);
                if (scope.fnType && scope.fnType.args.indexOf(callee) > -1) maybeInstantiate(scope, 30);
                const knownFn = callee.getFunctionType();
                if (knownFn && knownFn.instantiateScore && scope.fnType) maybeInstantiate(scope, knownFn.instantiateScore / 5);
                callee.propagate(new IsCallee(cx.topScope, args, node.arguments, out));
            }
        }),
        MemberExpression: ret((node, scope, c) => {
            const name = propName(node, scope);
            const prop = infer(node.object, scope, c).getProp(name);
            if (name == '<i>') {
                const propType = infer(node.property, scope, c);
                if (!propType.hasType(cx.num)) {
                    const target = new AVal();
                    prop.propagate(target, WG_MULTI_MEMBER);
                    return target;
                }
            }
            return prop;
        }),
        Identifier: ret((node, scope) => {
            if (node.name == 'arguments' && scope.fnType && !(node.name in scope.props)) {
                scope.defProp(node.name, scope.fnType.originNode)
                    .addType(new Arr(scope.fnType.arguments = new AVal()));
            }
            return scope.getProp(node.name);
        }),
        ThisExpression: ret((node, scope) => (scope.fnType ? scope.fnType.self : cx.topScope)),
        Literal: ret((node, scope) => literalType(node.value)),
    };

    function infer(node, scope, c, out, name) {
        return inferExprVisitor[node.type](node, scope, c, out, name);
    }

    var inferWrapper = walk.make({
        Expression(node, scope, c) {
            infer(node, scope, c, ANull);
        },

        FunctionDeclaration(node, scope, c) {
            const inner = node.body.scope; const
                fn = inner.fnType;
            c(node.body, scope, 'ScopeBody');
            maybeTagAsInstantiated(node, inner) || maybeTagAsGeneric(node, inner);
            const prop = scope.getProp(node.id.name);
            prop.addType(fn);
            interpretComments(node, node.comments, scope, prop, fn);
        },

        VariableDeclaration(node, scope, c) {
            for (let i = 0; i < node.declarations.length; ++i) {
                const decl = node.declarations[i]; const
                    prop = scope.getProp(decl.id.name);
                if (decl.init) infer(decl.init, scope, c, prop, decl.id.name);
                if (!i) interpretComments(node, node.comments, scope, prop);
            }
        },

        ReturnStatement(node, scope, c) {
            if (node.argument && scope.fnType) {
                if (scope.fnType.retval == ANull) scope.fnType.retval = new AVal();
                infer(node.argument, scope, c, scope.fnType.retval);
            }
        },

        ForInStatement(node, scope, c) {
            const source = infer(node.right, scope, c);
            if ((node.right.type == 'Identifier' && node.right.name in scope.props)
          || (node.right.type == 'MemberExpression' && node.right.property.name == 'prototype')) {
                maybeInstantiate(scope, 5);
                let varName;
                if (node.left.type == 'Identifier') {
                    varName = node.left.name;
                } else if (node.left.type == 'VariableDeclaration') {
                    varName = node.left.declarations[0].id.name;
                }
                if (varName && varName in scope.props) scope.getProp(varName).iteratesOver = source;
            }
            c(node.body, scope, 'Statement');
        },

        ScopeBody(node, scope, c) { c(node, node.scope || scope); },
    });

    // PARSING

    function isSpace(ch) {
        return (ch < 14 && ch > 8) || ch === 32 || ch === 160;
    }

    function onOwnLine(text, pos) {
        for (; pos > 0; --pos) {
            const ch = text.charCodeAt(pos - 1);
            if (ch == 10) break;
            if (!isSpace(ch)) return false;
        }
        return true;
    }

    // Gather comments directly before a function
    function commentsBefore(text, pos) {
        let found = '';
        let emptyLines = 0;
        out: while (pos > 0) {
            let prev = text.charCodeAt(pos - 1);
            if (prev == 10) {
                for (var scan = --pos, sawNonWS = false; scan > 0; --scan) {
                    prev = text.charCodeAt(scan - 1);
                    if (prev == 47 && text.charCodeAt(scan - 2) == 47) {
                        if (!onOwnLine(text, scan - 2)) break out;
                        found = text.slice(scan, pos) + found;
                        emptyLines = 0;
                        pos = scan - 2;
                        break;
                    } else if (prev == 10) {
                        if (!sawNonWS && ++emptyLines > 1) break out;
                        break;
                    } else if (!sawNonWS && !isSpace(prev)) {
                        sawNonWS = true;
                    }
                }
            } else if (prev == 47 && text.charCodeAt(pos - 2) == 42) {
                for (var scan = pos - 2; scan > 1; --scan) {
                    if (text.charCodeAt(scan - 1) == 42 && text.charCodeAt(scan - 2) == 47) {
                        if (!onOwnLine(text, scan - 2)) break out;
                        found = `${text.slice(scan, pos - 2)}\n${found}`;
                        emptyLines = 0;
                        break;
                    }
                }
                pos = scan - 2;
            } else if (isSpace(prev)) {
                --pos;
            } else {
                break;
            }
        }
        return found;
    }

    const parse = exports.parse = function (text) {
        let ast;
        try { ast = acorn.parse(text); } catch (e) { ast = acorn_loose.parse_dammit(text); }

        function attachComments(node) {
            const comments = commentsBefore(text, node.start);
            if (comments) node.comments = comments;
        }
        walk.simple(ast, {
            VariableDeclaration: attachComments,
            FunctionDeclaration: attachComments,
            ObjectExpression(node) {
                for (let i = 0; i < node.properties.length; ++i) attachComments(node.properties[i].key);
            },
        });
        return ast;
    };

    // ANALYSIS INTERFACE

    exports.analyze = function (ast, name, scope) {
        if (typeof ast === 'string') ast = parse(ast);

        if (!name) name = `file#${cx.origins.length}`;
        exports.addOrigin(cx.curOrigin = name);

        if (!scope) scope = cx.topScope;
        walk.recursive(ast, scope, null, scopeGatherer);
        walk.recursive(ast, scope, null, inferWrapper);

        cx.curOrigin = null;
    };

    // COMMENT INTERPRETATION

    function interpretComments(node, comments, scope, aval, type) {
        if (!comments) return;

        jsdoc.interpretComments(node, scope, aval, comments);

        if (!type && aval.types.length) {
            type = aval.types[aval.types.length - 1];
            if (!(type instanceof Obj) || type.origin != cx.curOrigin || type.doc) type = null;
        }

        const dot = comments.search(/\.\s/);
        if (dot > 5) comments = comments.slice(0, dot + 1);
        comments = comments.trim().replace(/\s*\n\s*\*\s*|\s{1,}/g, ' ');
        aval.doc = comments;
        if (type) type.doc = comments;
    }

    // PURGING

    exports.purgeTypes = function (origins, start, end) {
        const test = makePredicate(origins, start, end);
        ++cx.purgeGen;
        cx.topScope.purge(test);
        for (const prop in cx.props) {
            const list = cx.props[prop];
            for (let i = 0; i < list.length; ++i) {
                const obj = list[i];
                if (test(obj, obj.originNode)) list.splice(i--, 1);
            }
        }
    };

    function makePredicate(origins, start, end) {
        let arr = Array.isArray(origins);
        if (arr && origins.length == 1) { origins = origins[0]; arr = false; }
        if (arr) {
            if (end == null) return function (n) { return origins.indexOf(n.origin) > -1; };
            return function (n, pos) { return pos && pos.start >= start && pos.end <= end && origins.indexOf(n.origin) > -1; };
        }
        if (end == null) return function (n) { return n.origin == origins; };
        return function (n, pos) { return pos && pos.start >= start && pos.end <= end && n.origin == origins; };
    }

    AVal.prototype.purge = function (test) {
        if (this.purgeGen == cx.purgeGen) return;
        this.purgeGen = cx.purgeGen;
        for (var i = 0; i < this.types.length; ++i) {
            const type = this.types[i];
            if (test(type, type.originNode)) this.types.splice(i--, 1);
            else type.purge(test);
        }
        if (this.forward) {
            for (var i = 0; i < this.forward.length; ++i) {
                const f = this.forward[i];
                if (test(f)) {
                    this.forward.splice(i--, 1);
                    if (this.props) this.props = null;
                } else if (f.purge) {
                    f.purge(test);
                }
            }
        }
    };
    ANull.purge = function () {};
    Obj.prototype.purge = function (test) {
        if (this.purgeGen == cx.purgeGen) return true;
        this.purgeGen = cx.purgeGen;
        for (const p in this.props) this.props[p].purge(test);
    };
    Fn.prototype.purge = function (test) {
        if (Obj.prototype.purge.call(this, test)) return;
        this.self.purge(test);
        this.retval.purge(test);
        for (let i = 0; i < this.args.length; ++i) this.args[i].purge(test);
    };

    exports.markVariablesDefinedBy = function (scope, origins, start, end) {
        const test = makePredicate(origins, start, end);
        for (let s = scope; s; s = s.prev) {
            for (const p in s.props) {
                const prop = s.props[p];
                if (test(prop, prop.name)) prop.maybePurge = true;
            }
        }
    };

    exports.purgeMarkedVariables = function (scope) {
        for (let s = scope; s; s = s.prev) {
            for (const p in s.props) if (s.props[p].maybePurge) delete s.props[p];
        }
    };

    // EXPRESSION TYPE DETERMINATION

    function findByPropertyName(name) {
        guessing = true;
        const found = objsWithProp(name);
        if (found) {
            for (let i = 0; i < found.length; ++i) {
                const val = found[i].getProp(name);
                if (!val.isEmpty()) return val;
            }
        }
        return ANull;
    }

    const typeFinder = {
        ArrayExpression(node, scope) {
            const eltval = new AVal();
            for (let i = 0; i < node.elements.length; ++i) {
                const elt = node.elements[i];
                if (elt) findType(elt, scope).propagate(eltval);
            }
            return new Arr(eltval);
        },
        ObjectExpression(node) {
            return node.objType;
        },
        FunctionExpression(node) {
            return node.body.scope.fnType;
        },
        SequenceExpression(node, scope) {
            return findType(node.expressions[node.expressions.length - 1], scope);
        },
        UnaryExpression(node) {
            return unopResultType(node.operator);
        },
        UpdateExpression() {
            return cx.num;
        },
        BinaryExpression(node, scope) {
            if (binopIsBoolean(node.operator)) return cx.bool;
            if (node.operator == '+') {
                const lhs = findType(node.left, scope);
                const rhs = findType(node.right, scope);
                if (lhs.hasType(cx.str) || rhs.hasType(cx.str)) return cx.str;
            }
            return cx.num;
        },
        AssignmentExpression(node, scope) {
            return findType(node.right, scope);
        },
        LogicalExpression(node, scope) {
            const lhs = findType(node.left, scope);
            return lhs.isEmpty() ? findType(node.right, scope) : lhs;
        },
        ConditionalExpression(node, scope) {
            const lhs = findType(node.consequent, scope);
            return lhs.isEmpty() ? findType(node.alternate, scope) : lhs;
        },
        NewExpression(node, scope) {
            const f = findType(node.callee, scope).getFunctionType();
            const proto = f && f.getProp('prototype').getType();
            if (!proto) return ANull;
            return getInstance(proto, f);
        },
        CallExpression(node, scope) {
            const f = findType(node.callee, scope).getFunctionType();
            if (!f) return ANull;
            if (f.computeRet) {
                for (var i = 0, args = []; i < node.arguments.length; ++i) args.push(findType(node.arguments[i], scope));
                let self = ANull;
                if (node.callee.type == 'MemberExpression') self = findType(node.callee.object, scope);
                return f.computeRet(self, args, node.arguments);
            }
            return f.retval;
        },
        MemberExpression(node, scope) {
            const propN = propName(node, scope); const
                obj = findType(node.object, scope).getType();
            if (obj) return obj.getProp(propN);
            if (propN == '<i>') return ANull;
            return findByPropertyName(propN);
        },
        Identifier(node, scope) {
            return scope.hasProp(node.name) || ANull;
        },
        ThisExpression(node, scope) {
            return scope.fnType ? scope.fnType.self : cx.topScope;
        },
        Literal(node) {
            return literalType(node.value);
        },
    };

    function findType(node, scope) {
        const found = typeFinder[node.type](node, scope);
        return found;
    }

    const searchVisitor = exports.searchVisitor = walk.make({
        Function(node, st, c) {
            const { scope } = node.body;
            if (node.id) c(node.id, scope);
            for (let i = 0; i < node.params.length; ++i) c(node.params[i], scope);
            c(node.body, scope, 'ScopeBody');
        },
        TryStatement(node, st, c) {
            if (node.handler) c(node.handler.param, st);
            walk.base.TryStatement(node, st, c);
        },
        VariableDeclaration(node, st, c) {
            for (let i = 0; i < node.declarations.length; ++i) {
                const decl = node.declarations[i];
                c(decl.id, st);
                if (decl.init) c(decl.init, st, 'Expression');
            }
        },
    });
    const fullVisitor = exports.fullVisitor = walk.make({
        MemberExpression(node, st, c) {
            c(node.object, st, 'Expression');
            c(node.property, st, node.computed ? 'Expression' : null);
        },
        ObjectExpression(node, st, c) {
            for (let i = 0; i < node.properties.length; ++i) {
                c(node.properties[i].value, st, 'Expression');
                c(node.properties[i].key, st);
            }
        },
    }, searchVisitor);

    exports.findExpressionAt = function (ast, start, end, defaultScope, filter) {
        const test = filter || function (_t, node) { return typeFinder.hasOwnProperty(node.type); };
        return walk.findNodeAt(ast, start, end, test, searchVisitor, defaultScope || cx.topScope);
    };

    exports.findExpressionAround = function (ast, start, end, defaultScope, filter) {
        const test = filter || function (_t, node) {
            if (start != null && node.start > start) return false;
            return typeFinder.hasOwnProperty(node.type);
        };
        return walk.findNodeAround(ast, end, test, searchVisitor, defaultScope || cx.topScope);
    };

    exports.expressionType = function (found) {
        return findType(found.node, found.state);
    };

    // Flag used to indicate that some wild guessing was used to produce
    // a type or set of completions.
    var guessing = false;

    exports.resetGuessing = function (val) { guessing = val; };
    exports.didGuess = function () { return guessing; };

    exports.forAllPropertiesOf = function (type, f) {
        type.gatherProperties(f, 0);
    };

    const refFindWalker = walk.make({}, searchVisitor);

    exports.findRefs = function (ast, baseScope, name, refScope, f) {
        refFindWalker.Identifier = function (node, scope) {
            if (node.name != name) return;
            for (let s = scope; s; s = s.prev) {
                if (s == refScope) f(node, scope);
                if (name in s.props) return;
            }
        };
        walk.recursive(ast, baseScope, null, refFindWalker);
    };

    const simpleWalker = walk.make({
        Function(node, st, c) { c(node.body, node.body.scope, 'ScopeBody'); },
    });

    exports.findPropRefs = function (ast, scope, objType, propName, f) {
        walk.simple(ast, {
            MemberExpression(node, scope) {
                if (node.computed || node.property.name != propName) return;
                if (findType(node.object, scope).getType() == objType) f(node.property);
            },
            ObjectExpression(node, scope) {
                if (findType(node, scope).getType() != objType) return;
                for (let i = 0; i < node.properties.length; ++i) if (node.properties[i].key.name == propName) f(node.properties[i].key);
            },
        }, simpleWalker, scope);
    };

    // LOCAL-VARIABLE QUERIES

    const scopeAt = exports.scopeAt = function (ast, pos, defaultScope) {
        const found = walk.findNodeAround(ast, pos, 'ScopeBody');
        if (found) return found.node.scope;
        return defaultScope || cx.topScope;
    };

    exports.forAllLocalsAt = function (ast, pos, defaultScope, f) {
        const scope = scopeAt(ast, pos, defaultScope); const
            locals = [];
        scope.gatherProperties(f, 0);
    };
}));
