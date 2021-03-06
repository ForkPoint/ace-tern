import { types as tt } from './tokentype';
import { Parser } from './state';
import { lineBreak } from './whitespace';

const pp = Parser.prototype;

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.

pp.parseTopLevel = function (node) {
    let first = true;
    if (!node.body) node.body = [];
    while (this.type !== tt.eof) {
        const stmt = this.parseStatement(true, true);
        node.body.push(stmt);
        if (first && this.isUseStrict(stmt)) this.setStrict(true);
        first = false;
    }
    this.next();
    if (this.options.ecmaVersion >= 6) {
        node.sourceType = this.options.sourceType;
    }
    return this.finishNode(node, 'Program');
};

const loopLabel = { kind: 'loop' }; const
    switchLabel = { kind: 'switch' };

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

pp.parseStatement = function (declaration, topLevel) {
    const starttype = this.type; const
        node = this.startNode();

    // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
    case tt._break: case tt._continue: return this.parseBreakContinueStatement(node, starttype.keyword);
    case tt._debugger: return this.parseDebuggerStatement(node);
    case tt._do: return this.parseDoStatement(node);
    case tt._for: return this.parseForStatement(node);
    case tt._function:
        if (!declaration && this.options.ecmaVersion >= 6) this.unexpected();
        return this.parseFunctionStatement(node);
    case tt._class:
        if (!declaration) this.unexpected();
        return this.parseClass(node, true);
    case tt._if: return this.parseIfStatement(node);
    case tt._return: return this.parseReturnStatement(node);
    case tt._switch: return this.parseSwitchStatement(node);
    case tt._throw: return this.parseThrowStatement(node);
    case tt._try: return this.parseTryStatement(node);
    case tt._let: case tt._const: if (!declaration) this.unexpected(); // NOTE: falls through to _var
    case tt._var: return this.parseVarStatement(node, starttype);
    case tt._while: return this.parseWhileStatement(node);
    case tt._with: return this.parseWithStatement(node);
    case tt.braceL: return this.parseBlock();
    case tt.semi: return this.parseEmptyStatement(node);
    case tt._export:
    case tt._import:
        if (!this.options.allowImportExportEverywhere) {
            if (!topLevel) this.raise(this.start, "'import' and 'export' may only appear at the top level");
            if (!this.inModule) this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'");
        }
        return starttype === tt._import ? this.parseImport(node) : this.parseExport(node);

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
    default:
        const maybeName = this.value; const
            expr = this.parseExpression();
        if (starttype === tt.name && expr.type === 'Identifier' && this.eat(tt.colon)) return this.parseLabeledStatement(node, maybeName, expr);
        return this.parseExpressionStatement(node, expr);
    }
};

pp.parseBreakContinueStatement = function (node, keyword) {
    const isBreak = keyword == 'break';
    this.next();
    if (this.eat(tt.semi) || this.insertSemicolon()) node.label = null;
    else if (this.type !== tt.name) this.unexpected();
    else {
        node.label = this.parseIdent();
        this.semicolon();
    }

    // Verify that there is an actual destination to break or
    // continue to.
    for (var i = 0; i < this.labels.length; ++i) {
        const lab = this.labels[i];
        if (node.label == null || lab.name === node.label.name) {
            if (lab.kind != null && (isBreak || lab.kind === 'loop')) break;
            if (node.label && isBreak) break;
        }
    }
    if (i === this.labels.length) this.raise(node.start, `Unsyntactic ${keyword}`);
    return this.finishNode(node, isBreak ? 'BreakStatement' : 'ContinueStatement');
};

pp.parseDebuggerStatement = function (node) {
    this.next();
    this.semicolon();
    return this.finishNode(node, 'DebuggerStatement');
};

pp.parseDoStatement = function (node) {
    this.next();
    this.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.labels.pop();
    this.expect(tt._while);
    node.test = this.parseParenExpression();
    if (this.options.ecmaVersion >= 6) this.eat(tt.semi);
    else this.semicolon();
    return this.finishNode(node, 'DoWhileStatement');
};

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.

pp.parseForStatement = function (node) {
    this.next();
    this.labels.push(loopLabel);
    this.expect(tt.parenL);
    if (this.type === tt.semi) return this.parseFor(node, null);
    if (this.type === tt._var || this.type === tt._let || this.type === tt._const) {
        const init = this.startNode(); const
            varKind = this.type;
        this.next();
        this.parseVar(init, true, varKind);
        this.finishNode(init, 'VariableDeclaration');
        if ((this.type === tt._in || (this.options.ecmaVersion >= 6 && this.isContextual('of'))) && init.declarations.length === 1
        && !(varKind !== tt._var && init.declarations[0].init)) return this.parseForIn(node, init);
        return this.parseFor(node, init);
    }
    const refShorthandDefaultPos = { start: 0 };
    const init = this.parseExpression(true, refShorthandDefaultPos);
    if (this.type === tt._in || (this.options.ecmaVersion >= 6 && this.isContextual('of'))) {
        this.toAssignable(init);
        this.checkLVal(init);
        return this.parseForIn(node, init);
    } if (refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
    }
    return this.parseFor(node, init);
};

pp.parseFunctionStatement = function (node) {
    this.next();
    return this.parseFunction(node, true);
};

pp.parseIfStatement = function (node) {
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement(false);
    node.alternate = this.eat(tt._else) ? this.parseStatement(false) : null;
    return this.finishNode(node, 'IfStatement');
};

pp.parseReturnStatement = function (node) {
    if (!this.inFunction && !this.options.allowReturnOutsideFunction) this.raise(this.start, "'return' outside of function");
    this.next();

    // In `return` (and `break`/`continue`), the keywords with
    // optional arguments, we eagerly look for a semicolon or the
    // possibility to insert one.

    if (this.eat(tt.semi) || this.insertSemicolon()) node.argument = null;
    else { node.argument = this.parseExpression(); this.semicolon(); }
    return this.finishNode(node, 'ReturnStatement');
};

pp.parseSwitchStatement = function (node) {
    this.next();
    node.discriminant = this.parseParenExpression();
    node.cases = [];
    this.expect(tt.braceL);
    this.labels.push(switchLabel);

    // Statements under must be grouped (by label) in SwitchCase
    // nodes. `cur` is used to keep the node that we are currently
    // adding statements to.

    for (var cur, sawDefault; this.type != tt.braceR;) {
        if (this.type === tt._case || this.type === tt._default) {
            const isCase = this.type === tt._case;
            if (cur) this.finishNode(cur, 'SwitchCase');
            node.cases.push(cur = this.startNode());
            cur.consequent = [];
            this.next();
            if (isCase) {
                cur.test = this.parseExpression();
            } else {
                if (sawDefault) this.raise(this.lastTokStart, 'Multiple default clauses');
                sawDefault = true;
                cur.test = null;
            }
            this.expect(tt.colon);
        } else {
            if (!cur) this.unexpected();
            cur.consequent.push(this.parseStatement(true));
        }
    }
    if (cur) this.finishNode(cur, 'SwitchCase');
    this.next(); // Closing brace
    this.labels.pop();
    return this.finishNode(node, 'SwitchStatement');
};

pp.parseThrowStatement = function (node) {
    this.next();
    if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) this.raise(this.lastTokEnd, 'Illegal newline after throw');
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ThrowStatement');
};

// Reused empty array added for node fields that are always empty.

const empty = [];

pp.parseTryStatement = function (node) {
    this.next();
    node.block = this.parseBlock();
    node.handler = null;
    if (this.type === tt._catch) {
        const clause = this.startNode();
        this.next();
        this.expect(tt.parenL);
        clause.param = this.parseBindingAtom();
        this.checkLVal(clause.param, true);
        this.expect(tt.parenR);
        clause.guard = null;
        clause.body = this.parseBlock();
        node.handler = this.finishNode(clause, 'CatchClause');
    }
    node.guardedHandlers = empty;
    node.finalizer = this.eat(tt._finally) ? this.parseBlock() : null;
    if (!node.handler && !node.finalizer) this.raise(node.start, 'Missing catch or finally clause');
    return this.finishNode(node, 'TryStatement');
};

pp.parseVarStatement = function (node, kind) {
    this.next();
    this.parseVar(node, false, kind);
    this.semicolon();
    return this.finishNode(node, 'VariableDeclaration');
};

pp.parseWhileStatement = function (node) {
    this.next();
    node.test = this.parseParenExpression();
    this.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.labels.pop();
    return this.finishNode(node, 'WhileStatement');
};

pp.parseWithStatement = function (node) {
    if (this.strict) this.raise(this.start, "'with' in strict mode");
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement(false);
    return this.finishNode(node, 'WithStatement');
};

pp.parseEmptyStatement = function (node) {
    this.next();
    return this.finishNode(node, 'EmptyStatement');
};

pp.parseLabeledStatement = function (node, maybeName, expr) {
    for (let i = 0; i < this.labels.length; ++i) if (this.labels[i].name === maybeName) this.raise(expr.start, `Label '${maybeName}' is already declared`);
    const kind = this.type.isLoop ? 'loop' : this.type === tt._switch ? 'switch' : null;
    this.labels.push({ name: maybeName, kind });
    node.body = this.parseStatement(true);
    this.labels.pop();
    node.label = expr;
    return this.finishNode(node, 'LabeledStatement');
};

pp.parseExpressionStatement = function (node, expr) {
    node.expression = expr;
    this.semicolon();
    return this.finishNode(node, 'ExpressionStatement');
};

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).

pp.parseBlock = function (allowStrict) {
    const node = this.startNode(); let first = true; let
        oldStrict;
    node.body = [];
    this.expect(tt.braceL);
    while (!this.eat(tt.braceR)) {
        const stmt = this.parseStatement(true);
        node.body.push(stmt);
        if (first && allowStrict && this.isUseStrict(stmt)) {
            oldStrict = this.strict;
            this.setStrict(this.strict = true);
        }
        first = false;
    }
    if (oldStrict === false) this.setStrict(false);
    return this.finishNode(node, 'BlockStatement');
};

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.

pp.parseFor = function (node, init) {
    node.init = init;
    this.expect(tt.semi);
    node.test = this.type === tt.semi ? null : this.parseExpression();
    this.expect(tt.semi);
    node.update = this.type === tt.parenR ? null : this.parseExpression();
    this.expect(tt.parenR);
    node.body = this.parseStatement(false);
    this.labels.pop();
    return this.finishNode(node, 'ForStatement');
};

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.

pp.parseForIn = function (node, init) {
    const type = this.type === tt._in ? 'ForInStatement' : 'ForOfStatement';
    this.next();
    node.left = init;
    node.right = this.parseExpression();
    this.expect(tt.parenR);
    node.body = this.parseStatement(false);
    this.labels.pop();
    return this.finishNode(node, type);
};

// Parse a list of variable declarations.

pp.parseVar = function (node, isFor, kind) {
    node.declarations = [];
    node.kind = kind.keyword;
    for (;;) {
        const decl = this.startNode();
        decl.id = this.parseBindingAtom();
        this.checkLVal(decl.id, true);
        if (this.eat(tt.eq)) {
            decl.init = this.parseMaybeAssign(isFor);
        } else if (kind === tt._const && !(this.type === tt._in || (this.options.ecmaVersion >= 6 && this.isContextual('of')))) {
            this.unexpected();
        } else if (decl.id.type != 'Identifier' && !(isFor && (this.type === tt._in || this.isContextual('of')))) {
            this.raise(this.lastTokEnd, 'Complex binding patterns require an initialization value');
        } else {
            decl.init = null;
        }
        node.declarations.push(this.finishNode(decl, 'VariableDeclarator'));
        if (!this.eat(tt.comma)) break;
    }
    return node;
};

// Parse a function declaration or literal (depending on the
// `isStatement` parameter).

pp.parseFunction = function (node, isStatement, allowExpressionBody) {
    this.initFunction(node);
    if (this.options.ecmaVersion >= 6) node.generator = this.eat(tt.star);
    if (isStatement || this.type === tt.name) node.id = this.parseIdent();
    this.expect(tt.parenL);
    node.params = this.parseBindingList(tt.parenR, false, false);
    this.parseFunctionBody(node, allowExpressionBody);
    return this.finishNode(node, isStatement ? 'FunctionDeclaration' : 'FunctionExpression');
};

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).

pp.parseClass = function (node, isStatement) {
    this.next();
    node.id = this.type === tt.name ? this.parseIdent() : isStatement ? this.unexpected() : null;
    node.superClass = this.eat(tt._extends) ? this.parseExprSubscripts() : null;
    const classBody = this.startNode();
    classBody.body = [];
    this.expect(tt.braceL);
    while (!this.eat(tt.braceR)) {
        if (this.eat(tt.semi)) continue;
        const method = this.startNode();
        let isGenerator = this.eat(tt.star);
        this.parsePropertyName(method);
        if (this.type !== tt.parenL && !method.computed && method.key.type === 'Identifier'
        && method.key.name === 'static') {
            if (isGenerator) this.unexpected();
            method.static = true;
            isGenerator = this.eat(tt.star);
            this.parsePropertyName(method);
        } else {
            method.static = false;
        }
        method.kind = 'method';
        if (!method.computed && !isGenerator) {
            if (method.key.type === 'Identifier') {
                if (this.type !== tt.parenL && (method.key.name === 'get' || method.key.name === 'set')) {
                    method.kind = method.key.name;
                    this.parsePropertyName(method);
                } else if (!method.static && method.key.name === 'constructor') {
                    method.kind = 'constructor';
                }
            } else if (!method.static && method.key.type === 'Literal' && method.key.value === 'constructor') {
                method.kind = 'constructor';
            }
        }
        method.value = this.parseMethod(isGenerator);
        classBody.body.push(this.finishNode(method, 'MethodDefinition'));
    }
    node.body = this.finishNode(classBody, 'ClassBody');
    return this.finishNode(node, isStatement ? 'ClassDeclaration' : 'ClassExpression');
};

// Parses module export declaration.

pp.parseExport = function (node) {
    this.next();
    // export * from '...'
    if (this.eat(tt.star)) {
        this.expectContextual('from');
        node.source = this.type === tt.string ? this.parseExprAtom() : this.unexpected();
        this.semicolon();
        return this.finishNode(node, 'ExportAllDeclaration');
    }
    if (this.eat(tt._default)) { // export default ...
        const expr = this.parseMaybeAssign();
        let needsSemi = true;
        if (expr.type == 'FunctionExpression'
        || expr.type == 'ClassExpression') {
            needsSemi = false;
            if (expr.id) {
                expr.type = expr.type == 'FunctionExpression'
                    ? 'FunctionDeclaration'
                    : 'ClassDeclaration';
            }
        }
        node.declaration = expr;
        if (needsSemi) this.semicolon();
        return this.finishNode(node, 'ExportDefaultDeclaration');
    }
    // export var|const|let|function|class ...
    if (this.type.keyword) {
        node.declaration = this.parseStatement(true);
        node.specifiers = [];
        node.source = null;
    } else { // export { x, y as z } [from '...']
        node.declaration = null;
        node.specifiers = this.parseExportSpecifiers();
        if (this.eatContextual('from')) {
            node.source = this.type === tt.string ? this.parseExprAtom() : this.unexpected();
        } else {
            node.source = null;
        }
        this.semicolon();
    }
    return this.finishNode(node, 'ExportNamedDeclaration');
};

// Parses a comma-separated list of module exports.

pp.parseExportSpecifiers = function () {
    const nodes = []; let
        first = true;
    // export { x, y as z } [from '...']
    this.expect(tt.braceL);
    while (!this.eat(tt.braceR)) {
        if (!first) {
            this.expect(tt.comma);
            if (this.afterTrailingComma(tt.braceR)) break;
        } else first = false;

        const node = this.startNode();
        node.local = this.parseIdent(this.type === tt._default);
        node.exported = this.eatContextual('as') ? this.parseIdent(true) : node.local;
        nodes.push(this.finishNode(node, 'ExportSpecifier'));
    }
    return nodes;
};

// Parses import declaration.

pp.parseImport = function (node) {
    this.next();
    // import '...'
    if (this.type === tt.string) {
        node.specifiers = empty;
        node.source = this.parseExprAtom();
        node.kind = '';
    } else {
        node.specifiers = this.parseImportSpecifiers();
        this.expectContextual('from');
        node.source = this.type === tt.string ? this.parseExprAtom() : this.unexpected();
    }
    this.semicolon();
    return this.finishNode(node, 'ImportDeclaration');
};

// Parses a comma-separated list of module imports.

pp.parseImportSpecifiers = function () {
    const nodes = []; let
        first = true;
    if (this.type === tt.name) {
    // import defaultObj, { x, y as z } from '...'
        const node = this.startNode();
        node.local = this.parseIdent();
        this.checkLVal(node.local, true);
        nodes.push(this.finishNode(node, 'ImportDefaultSpecifier'));
        if (!this.eat(tt.comma)) return nodes;
    }
    if (this.type === tt.star) {
        const node = this.startNode();
        this.next();
        this.expectContextual('as');
        node.local = this.parseIdent();
        this.checkLVal(node.local, true);
        nodes.push(this.finishNode(node, 'ImportNamespaceSpecifier'));
        return nodes;
    }
    this.expect(tt.braceL);
    while (!this.eat(tt.braceR)) {
        if (!first) {
            this.expect(tt.comma);
            if (this.afterTrailingComma(tt.braceR)) break;
        } else first = false;

        const node = this.startNode();
        node.imported = this.parseIdent(true);
        node.local = this.eatContextual('as') ? this.parseIdent() : node.imported;
        this.checkLVal(node.local, true);
        nodes.push(this.finishNode(node, 'ImportSpecifier'));
    }
    return nodes;
};
