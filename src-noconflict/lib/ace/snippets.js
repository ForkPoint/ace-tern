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
    const oop = require('./lib/oop');
    const { EventEmitter } = require('./lib/event_emitter');
    const lang = require('./lib/lang');
    const { Range } = require('./range');
    const { RangeList } = require('./range_list');
    const { HashHandler } = require('./keyboard/hash_handler');
    const { Tokenizer } = require('./tokenizer');
    const clipboard = require('./clipboard');

    const VARIABLES = {
        CURRENT_WORD(editor) {
            return editor.session.getTextRange(editor.session.getWordRange());
        },
        SELECTION(editor, name, indentation) {
            const text = editor.session.getTextRange();
            if (indentation) return text.replace(/\n\r?([ \t]*\S)/g, `\n${indentation}$1`);
            return text;
        },
        CURRENT_LINE(editor) {
            return editor.session.getLine(editor.getCursorPosition().row);
        },
        PREV_LINE(editor) {
            return editor.session.getLine(editor.getCursorPosition().row - 1);
        },
        LINE_INDEX(editor) {
            return editor.getCursorPosition().row;
        },
        LINE_NUMBER(editor) {
            return editor.getCursorPosition().row + 1;
        },
        SOFT_TABS(editor) {
            return editor.session.getUseSoftTabs() ? 'YES' : 'NO';
        },
        TAB_SIZE(editor) {
            return editor.session.getTabSize();
        },
        CLIPBOARD(editor) {
            return clipboard.getText && clipboard.getText();
        },
        // filenames
        FILENAME(editor) {
            return /[^/\\]*$/.exec(this.FILEPATH(editor))[0];
        },
        FILENAME_BASE(editor) {
            return /[^/\\]*$/.exec(this.FILEPATH(editor))[0].replace(/\.[^.]*$/, '');
        },
        DIRECTORY(editor) {
            return this.FILEPATH(editor).replace(/[^/\\]*$/, '');
        },
        FILEPATH(editor) { return '/not implemented.txt'; },
        WORKSPACE_NAME() { return 'Unknown'; },
        FULLNAME() { return 'Unknown'; },
        // comments
        BLOCK_COMMENT_START(editor) {
            const mode = editor.session.$mode || {};
            return mode.blockComment && mode.blockComment.start || '';
        },
        BLOCK_COMMENT_END(editor) {
            const mode = editor.session.$mode || {};
            return mode.blockComment && mode.blockComment.end || '';
        },
        LINE_COMMENT(editor) {
            const mode = editor.session.$mode || {};
            return mode.lineCommentStart || '';
        },
        // dates
        CURRENT_YEAR: date.bind(null, { year: 'numeric' }),
        CURRENT_YEAR_SHORT: date.bind(null, { year: '2-digit' }),
        CURRENT_MONTH: date.bind(null, { month: 'numeric' }),
        CURRENT_MONTH_NAME: date.bind(null, { month: 'long' }),
        CURRENT_MONTH_NAME_SHORT: date.bind(null, { month: 'short' }),
        CURRENT_DATE: date.bind(null, { day: '2-digit' }),
        CURRENT_DAY_NAME: date.bind(null, { weekday: 'long' }),
        CURRENT_DAY_NAME_SHORT: date.bind(null, { weekday: 'short' }),
        CURRENT_HOUR: date.bind(null, { hour: '2-digit', hour12: false }),
        CURRENT_MINUTE: date.bind(null, { minute: '2-digit' }),
        CURRENT_SECOND: date.bind(null, { second: '2-digit' }),
    };

    VARIABLES.SELECTED_TEXT = VARIABLES.SELECTION;

    function date(dateFormat) {
        const str = new Date().toLocaleString('en-us', dateFormat);
        return str.length == 1 ? `0${str}` : str;
    }

    const SnippetManager = function () {
        this.snippetMap = {};
        this.snippetNameMap = {};
    };

    (function () {
        oop.implement(this, EventEmitter);

        this.getTokenizer = function () {
            return SnippetManager.$tokenizer || this.createTokenizer();
        };

        this.createTokenizer = function () {
            function TabstopToken(str) {
                str = str.substr(1);
                if (/^\d+$/.test(str)) return [{ tabstopId: parseInt(str, 10) }];
                return [{ text: str }];
            }
            function escape(ch) {
                return `(?:[^\\\\${ch}]|\\\\.)`;
            }
            const formatMatcher = {
                regex: `/(${escape('/')}+)/`,
                onMatch(val, state, stack) {
                    const ts = stack[0];
                    ts.fmtString = true;
                    ts.guard = val.slice(1, -1);
                    ts.flag = '';
                    return '';
                },
                next: 'formatString',
            };

            SnippetManager.$tokenizer = new Tokenizer({
                start: [
                    {
                        regex: /\\./,
                        onMatch(val, state, stack) {
                            const ch = val[1];
                            if (ch == '}' && stack.length) {
                                val = ch;
                            } else if ('`$\\'.indexOf(ch) != -1) {
                                val = ch;
                            }
                            return [val];
                        },
                    },
                    {
                        regex: /}/,
                        onMatch(val, state, stack) {
                            return [stack.length ? stack.shift() : val];
                        },
                    },
                    { regex: /\$(?:\d+|\w+)/, onMatch: TabstopToken },
                    {
                        regex: /\$\{[\dA-Z_a-z]+/,
                        onMatch(str, state, stack) {
                            const t = TabstopToken(str.substr(1));
                            stack.unshift(t[0]);
                            return t;
                        },
                        next: 'snippetVar',
                    },
                    { regex: /\n/, token: 'newline', merge: false },
                ],
                snippetVar: [
                    {
                        regex: `\\|${escape('\\|')}*\\|`,
                        onMatch(val, state, stack) {
                            const choices = val.slice(1, -1).replace(/\\[,|\\]|,/g, (operator) => (operator.length == 2 ? operator[1] : '\x00')).split('\x00');
                            stack[0].choices = choices;
                            return [choices[0]];
                        },
                        next: 'start',
                    },
                    formatMatcher,
                    { regex: '([^:}\\\\]|\\\\.)*:?', token: '', next: 'start' },
                ],
                formatString: [
                    {
                        regex: /:/,
                        onMatch(val, state, stack) {
                            if (stack.length && stack[0].expectElse) {
                                stack[0].expectElse = false;
                                stack[0].ifEnd = { elseEnd: stack[0] };
                                return [stack[0].ifEnd];
                            }
                            return ':';
                        },
                    },
                    {
                        regex: /\\./,
                        onMatch(val, state, stack) {
                            const ch = val[1];
                            if (ch == '}' && stack.length) val = ch;
                            else if ('`$\\'.indexOf(ch) != -1) val = ch;
                            else if (ch == 'n') val = '\n';
                            else if (ch == 't') val = '\t';
                            else if ('ulULE'.indexOf(ch) != -1) val = { changeCase: ch, local: ch > 'a' };
                            return [val];
                        },
                    },
                    {
                        regex: '/\\w*}',
                        onMatch(val, state, stack) {
                            const next = stack.shift();
                            if (next) next.flag = val.slice(1, -1);
                            this.next = next && next.tabstopId ? 'start' : '';
                            return [next || val];
                        },
                        next: 'start',
                    },
                    {
                        regex: /\$(?:\d+|\w+)/,
                        onMatch(val, state, stack) {
                            return [{ text: val.slice(1) }];
                        },
                    },
                    {
                        regex: /\${\w+/,
                        onMatch(val, state, stack) {
                            const token = { text: val.slice(2) };
                            stack.unshift(token);
                            return [token];
                        },
                        next: 'formatStringVar',
                    },
                    { regex: /\n/, token: 'newline', merge: false },
                    {
                        regex: /}/,
                        onMatch(val, state, stack) {
                            const next = stack.shift();
                            this.next = next && next.tabstopId ? 'start' : '';
                            return [next || val];
                        },
                        next: 'start',
                    },
                ],
                formatStringVar: [
                    {
                        regex: /:\/\w+}/,
                        onMatch(val, state, stack) {
                            const ts = stack[0];
                            ts.formatFunction = val.slice(2, -1);
                            return [stack.shift()];
                        },
                        next: 'formatString',
                    },
                    formatMatcher,
                    {
                        regex: /:[\?\-+]?/,
                        onMatch(val, state, stack) {
                            if (val[1] == '+') stack[0].ifEnd = stack[0];
                            if (val[1] == '?') stack[0].expectElse = true;
                        },
                        next: 'formatString',
                    },
                    { regex: '([^:}\\\\]|\\\\.)*:?', token: '', next: 'formatString' },
                ],
            });
            return SnippetManager.$tokenizer;
        };

        this.tokenizeTmSnippet = function (str, startState) {
            return this.getTokenizer().getLineTokens(str, startState).tokens.map((x) => x.value || x);
        };

        this.getVariableValue = function (editor, name, indentation) {
            if (/^\d+$/.test(name)) return (this.variables.__ || {})[name] || '';
            if (/^[A-Z]\d+$/.test(name)) return (this.variables[`${name[0]}__`] || {})[name.substr(1)] || '';

            name = name.replace(/^TM_/, '');
            if (!this.variables.hasOwnProperty(name)) return '';
            let value = this.variables[name];
            if (typeof value === 'function') value = this.variables[name](editor, name, indentation);
            return value == null ? '' : value;
        };

        this.variables = VARIABLES;

        // returns string formatted according to http://manual.macromates.com/en/regular_expressions#replacement_string_syntax_format_strings
        this.tmStrFormat = function (str, ch, editor) {
            if (!ch.fmt) return str;
            const flag = ch.flag || '';
            let re = ch.guard;
            re = new RegExp(re, flag.replace(/[^gim]/g, ''));
            const fmtTokens = typeof ch.fmt === 'string' ? this.tokenizeTmSnippet(ch.fmt, 'formatString') : ch.fmt;
            const _self = this;
            const formatted = str.replace(re, function () {
                const oldArgs = _self.variables.__;
                _self.variables.__ = [].slice.call(arguments);
                const fmtParts = _self.resolveVariables(fmtTokens, editor);
                let gChangeCase = 'E';
                for (let i = 0; i < fmtParts.length; i++) {
                    const ch = fmtParts[i];
                    if (typeof ch === 'object') {
                        fmtParts[i] = '';
                        if (ch.changeCase && ch.local) {
                            const next = fmtParts[i + 1];
                            if (next && typeof next === 'string') {
                                if (ch.changeCase == 'u') fmtParts[i] = next[0].toUpperCase();
                                else fmtParts[i] = next[0].toLowerCase();
                                fmtParts[i + 1] = next.substr(1);
                            }
                        } else if (ch.changeCase) {
                            gChangeCase = ch.changeCase;
                        }
                    } else if (gChangeCase == 'U') {
                        fmtParts[i] = ch.toUpperCase();
                    } else if (gChangeCase == 'L') {
                        fmtParts[i] = ch.toLowerCase();
                    }
                }
                _self.variables.__ = oldArgs;
                return fmtParts.join('');
            });
            return formatted;
        };

        this.tmFormatFunction = function (str, ch, editor) {
            if (ch.formatFunction == 'upcase') return str.toUpperCase();
            if (ch.formatFunction == 'downcase') return str.toLowerCase();
            return str;
        };

        this.resolveVariables = function (snippet, editor) {
            const result = [];
            let indentation = '';
            let afterNewLine = true;
            for (var i = 0; i < snippet.length; i++) {
                const ch = snippet[i];
                if (typeof ch === 'string') {
                    result.push(ch);
                    if (ch == '\n') {
                        afterNewLine = true;
                        indentation = '';
                    } else if (afterNewLine) {
                        indentation = /^\t*/.exec(ch)[0];
                        afterNewLine = /\S/.test(ch);
                    }
                    continue;
                }
                if (!ch) continue;
                afterNewLine = false;

                if (ch.fmtString) {
                    let j = snippet.indexOf(ch, i + 1);
                    if (j == -1) j = snippet.length;
                    ch.fmt = snippet.slice(i + 1, j);
                    i = j;
                }

                if (ch.text) {
                    let value = `${this.getVariableValue(editor, ch.text, indentation)}`;
                    if (ch.fmtString) value = this.tmStrFormat(value, ch, editor);
                    if (ch.formatFunction) value = this.tmFormatFunction(value, ch, editor);

                    if (value && !ch.ifEnd) {
                        result.push(value);
                        gotoNext(ch);
                    } else if (!value && ch.ifEnd) {
                        gotoNext(ch.ifEnd);
                    }
                } else if (ch.elseEnd) {
                    gotoNext(ch.elseEnd);
                } else if (ch.tabstopId != null) {
                    result.push(ch);
                } else if (ch.changeCase != null) {
                    result.push(ch);
                }
            }
            function gotoNext(ch) {
                const i1 = snippet.indexOf(ch, i + 1);
                if (i1 != -1) i = i1;
            }
            return result;
        };

        this.insertSnippetForSelection = function (editor, snippetText) {
            const cursor = editor.getCursorPosition();
            const line = editor.session.getLine(cursor.row);
            const tabString = editor.session.getTabString();
            let indentString = line.match(/^\s*/)[0];

            if (cursor.column < indentString.length) indentString = indentString.slice(0, cursor.column);

            snippetText = snippetText.replace(/\r/g, '');
            let tokens = this.tokenizeTmSnippet(snippetText);
            tokens = this.resolveVariables(tokens, editor);
            // indent
            tokens = tokens.map((x) => {
                if (x == '\n') return x + indentString;
                if (typeof x === 'string') return x.replace(/\t/g, tabString);
                return x;
            });
            // tabstop values
            const tabstops = [];
            tokens.forEach((p, i) => {
                if (typeof p !== 'object') return;
                const id = p.tabstopId;
                let ts = tabstops[id];
                if (!ts) {
                    ts = tabstops[id] = [];
                    ts.index = id;
                    ts.value = '';
                    ts.parents = {};
                }
                if (ts.indexOf(p) !== -1) return;
                if (p.choices && !ts.choices) ts.choices = p.choices;
                ts.push(p);
                const i1 = tokens.indexOf(p, i + 1);
                if (i1 === -1) return;

                const value = tokens.slice(i + 1, i1);
                const isNested = value.some((t) => typeof t === 'object');
                if (isNested && !ts.value) {
                    ts.value = value;
                } else if (value.length && (!ts.value || typeof ts.value !== 'string')) {
                    ts.value = value.join('');
                }
            });

            // expand tabstop values
            tabstops.forEach((ts) => { ts.length = 0; });
            const expanding = {};
            function copyValue(val) {
                const copy = [];
                for (let i = 0; i < val.length; i++) {
                    let p = val[i];
                    if (typeof p === 'object') {
                        if (expanding[p.tabstopId]) continue;
                        const j = val.lastIndexOf(p, i - 1);
                        p = copy[j] || { tabstopId: p.tabstopId };
                    }
                    copy[i] = p;
                }
                return copy;
            }
            for (let i = 0; i < tokens.length; i++) {
                const p = tokens[i];
                if (typeof p !== 'object') continue;
                const id = p.tabstopId;
                var ts = tabstops[id];
                const i1 = tokens.indexOf(p, i + 1);
                if (expanding[id]) {
                // if reached closing bracket clear expanding state
                    if (expanding[id] === p) {
                        delete expanding[id];
                        Object.keys(expanding).forEach((parentId) => {
                            ts.parents[parentId] = true;
                        });
                    }
                    // otherwise just ignore recursive tabstop
                    continue;
                }
                expanding[id] = p;
                let { value } = ts;
                if (typeof value !== 'string') value = copyValue(value);
                else if (p.fmt) value = this.tmStrFormat(value, p, editor);
                tokens.splice.apply(tokens, [i + 1, Math.max(0, i1 - i)].concat(value, p));

                if (ts.indexOf(p) === -1) ts.push(p);
            }

            // convert to plain text
            let row = 0; let
                column = 0;
            let text = '';
            tokens.forEach((t) => {
                if (typeof t === 'string') {
                    const lines = t.split('\n');
                    if (lines.length > 1) {
                        column = lines[lines.length - 1].length;
                        row += lines.length - 1;
                    } else column += t.length;
                    text += t;
                } else if (t) {
                    if (!t.start) t.start = { row, column };
                    else t.end = { row, column };
                }
            });
            const range = editor.getSelectionRange();
            const end = editor.session.replace(range, text);

            const tabstopManager = new TabstopManager(editor);
            const selectionId = editor.inVirtualSelectionMode && editor.selection.index;
            tabstopManager.addTabstops(tabstops, range.start, end, selectionId);
        };

        this.insertSnippet = function (editor, snippetText) {
            const self = this;
            if (editor.inVirtualSelectionMode) return self.insertSnippetForSelection(editor, snippetText);

            editor.forEachSelection(() => {
                self.insertSnippetForSelection(editor, snippetText);
            }, null, { keepOrder: true });

            if (editor.tabstopManager) editor.tabstopManager.tabNext();
        };

        this.$getScope = function (editor) {
            let scope = editor.session.$mode.$id || '';
            scope = scope.split('/').pop();
            if (scope === 'html' || scope === 'php') {
            // PHP is actually HTML
                if (scope === 'php' && !editor.session.$mode.inlinePhp) scope = 'html';
                const c = editor.getCursorPosition();
                let state = editor.session.getState(c.row);
                if (typeof state === 'object') {
                    state = state[0];
                }
                if (state.substring) {
                    if (state.substring(0, 3) == 'js-') scope = 'javascript';
                    else if (state.substring(0, 4) == 'css-') scope = 'css';
                    else if (state.substring(0, 4) == 'php-') scope = 'php';
                }
            }

            return scope;
        };

        this.getActiveScopes = function (editor) {
            const scope = this.$getScope(editor);
            const scopes = [scope];
            const { snippetMap } = this;
            if (snippetMap[scope] && snippetMap[scope].includeScopes) {
                scopes.push.apply(scopes, snippetMap[scope].includeScopes);
            }
            scopes.push('_');
            return scopes;
        };

        this.expandWithTab = function (editor, options) {
            const self = this;
            const result = editor.forEachSelection(() => self.expandSnippetForSelection(editor, options), null, { keepOrder: true });
            if (result && editor.tabstopManager) editor.tabstopManager.tabNext();
            return result;
        };

        this.expandSnippetForSelection = function (editor, options) {
            const cursor = editor.getCursorPosition();
            const line = editor.session.getLine(cursor.row);
            const before = line.substring(0, cursor.column);
            const after = line.substr(cursor.column);

            const { snippetMap } = this;
            let snippet;
            this.getActiveScopes(editor).some(function (scope) {
                const snippets = snippetMap[scope];
                if (snippets) snippet = this.findMatchingSnippet(snippets, before, after);
                return !!snippet;
            }, this);
            if (!snippet) return false;
            if (options && options.dryRun) return true;
            editor.session.doc.removeInLine(cursor.row,
                cursor.column - snippet.replaceBefore.length,
                cursor.column + snippet.replaceAfter.length);

            this.variables.M__ = snippet.matchBefore;
            this.variables.T__ = snippet.matchAfter;
            this.insertSnippetForSelection(editor, snippet.content);

            this.variables.M__ = this.variables.T__ = null;
            return true;
        };

        this.findMatchingSnippet = function (snippetList, before, after) {
            for (let i = snippetList.length; i--;) {
                const s = snippetList[i];
                if (s.startRe && !s.startRe.test(before)) continue;
                if (s.endRe && !s.endRe.test(after)) continue;
                if (!s.startRe && !s.endRe) continue;

                s.matchBefore = s.startRe ? s.startRe.exec(before) : [''];
                s.matchAfter = s.endRe ? s.endRe.exec(after) : [''];
                s.replaceBefore = s.triggerRe ? s.triggerRe.exec(before)[0] : '';
                s.replaceAfter = s.endTriggerRe ? s.endTriggerRe.exec(after)[0] : '';
                return s;
            }
        };

        this.snippetMap = {};
        this.snippetNameMap = {};
        this.register = function (snippets, scope) {
            const { snippetMap } = this;
            const { snippetNameMap } = this;
            const self = this;

            if (!snippets) snippets = [];

            function wrapRegexp(src) {
                if (src && !/^\^?\(.*\)\$?$|^\\b$/.test(src)) src = `(?:${src})`;

                return src || '';
            }
            function guardedRegexp(re, guard, opening) {
                re = wrapRegexp(re);
                guard = wrapRegexp(guard);
                if (opening) {
                    re = guard + re;
                    if (re && re[re.length - 1] != '$') re = `${re}$`;
                } else {
                    re += guard;
                    if (re && re[0] != '^') re = `^${re}`;
                }
                return new RegExp(re);
            }

            function addSnippet(s) {
                if (!s.scope) s.scope = scope || '_';
                scope = s.scope;
                if (!snippetMap[scope]) {
                    snippetMap[scope] = [];
                    snippetNameMap[scope] = {};
                }

                const map = snippetNameMap[scope];
                if (s.name) {
                    const old = map[s.name];
                    if (old) self.unregister(old);
                    map[s.name] = s;
                }
                snippetMap[scope].push(s);

                if (s.tabTrigger && !s.trigger) {
                    if (!s.guard && /^\w/.test(s.tabTrigger)) s.guard = '\\b';
                    s.trigger = lang.escapeRegExp(s.tabTrigger);
                }

                if (!s.trigger && !s.guard && !s.endTrigger && !s.endGuard) return;

                s.startRe = guardedRegexp(s.trigger, s.guard, true);
                s.triggerRe = new RegExp(s.trigger);

                s.endRe = guardedRegexp(s.endTrigger, s.endGuard, true);
                s.endTriggerRe = new RegExp(s.endTrigger);
            }

            if (snippets && snippets.content) addSnippet(snippets);
            else if (Array.isArray(snippets)) snippets.forEach(addSnippet);

            this._signal('registerSnippets', { scope });
        };
        this.unregister = function (snippets, scope) {
            const { snippetMap } = this;
            const { snippetNameMap } = this;

            function removeSnippet(s) {
                const nameMap = snippetNameMap[s.scope || scope];
                if (nameMap && nameMap[s.name]) {
                    delete nameMap[s.name];
                    const map = snippetMap[s.scope || scope];
                    const i = map && map.indexOf(s);
                    if (i >= 0) map.splice(i, 1);
                }
            }
            if (snippets.content) removeSnippet(snippets);
            else if (Array.isArray(snippets)) snippets.forEach(removeSnippet);
        };
        this.parseSnippetFile = function (str) {
            str = str.replace(/\r/g, '');
            const list = []; let
                snippet = {};
            const re = /^#.*|^({[\s\S]*})\s*$|^(\S+) (.*)$|^((?:\n*\t.*)+)/gm;
            let m;
            while (m = re.exec(str)) {
                if (m[1]) {
                    try {
                        snippet = JSON.parse(m[1]);
                        list.push(snippet);
                    } catch (e) {}
                } if (m[4]) {
                    snippet.content = m[4].replace(/^\t/gm, '');
                    list.push(snippet);
                    snippet = {};
                } else {
                    const key = m[2]; const
                        val = m[3];
                    if (key == 'regex') {
                        const guardRe = /\/((?:[^\/\\]|\\.)*)|$/g;
                        snippet.guard = guardRe.exec(val)[1];
                        snippet.trigger = guardRe.exec(val)[1];
                        snippet.endTrigger = guardRe.exec(val)[1];
                        snippet.endGuard = guardRe.exec(val)[1];
                    } else if (key == 'snippet') {
                        snippet.tabTrigger = val.match(/^\S*/)[0];
                        if (!snippet.name) snippet.name = val;
                    } else {
                        snippet[key] = val;
                    }
                }
            }
            return list;
        };
        this.getSnippetByName = function (name, editor) {
            const snippetMap = this.snippetNameMap;
            let snippet;
            this.getActiveScopes(editor).some((scope) => {
                const snippets = snippetMap[scope];
                if (snippets) snippet = snippets[name];
                return !!snippet;
            }, this);
            return snippet;
        };
    }).call(SnippetManager.prototype);


    var TabstopManager = function (editor) {
        if (editor.tabstopManager) return editor.tabstopManager;
        editor.tabstopManager = this;
        this.$onChange = this.onChange.bind(this);
        this.$onChangeSelection = lang.delayedCall(this.onChangeSelection.bind(this)).schedule;
        this.$onChangeSession = this.onChangeSession.bind(this);
        this.$onAfterExec = this.onAfterExec.bind(this);
        this.attach(editor);
    };
    (function () {
        this.attach = function (editor) {
            this.index = 0;
            this.ranges = [];
            this.tabstops = [];
            this.$openTabstops = null;
            this.selectedTabstop = null;

            this.editor = editor;
            this.editor.on('change', this.$onChange);
            this.editor.on('changeSelection', this.$onChangeSelection);
            this.editor.on('changeSession', this.$onChangeSession);
            this.editor.commands.on('afterExec', this.$onAfterExec);
            this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
        };
        this.detach = function () {
            this.tabstops.forEach(this.removeTabstopMarkers, this);
            this.ranges = null;
            this.tabstops = null;
            this.selectedTabstop = null;
            this.editor.removeListener('change', this.$onChange);
            this.editor.removeListener('changeSelection', this.$onChangeSelection);
            this.editor.removeListener('changeSession', this.$onChangeSession);
            this.editor.commands.removeListener('afterExec', this.$onAfterExec);
            this.editor.keyBinding.removeKeyboardHandler(this.keyboardHandler);
            this.editor.tabstopManager = null;
            this.editor = null;
        };

        this.onChange = function (delta) {
            const isRemove = delta.action[0] == 'r';
            const selectedTabstop = this.selectedTabstop || {};
            const parents = selectedTabstop.parents || {};
            const tabstops = (this.tabstops || []).slice();
            for (let i = 0; i < tabstops.length; i++) {
                const ts = tabstops[i];
                const active = ts == selectedTabstop || parents[ts.index];
                ts.rangeList.$bias = active ? 0 : 1;

                if (delta.action == 'remove' && ts !== selectedTabstop) {
                    const parentActive = ts.parents && ts.parents[selectedTabstop.index];
                    let startIndex = ts.rangeList.pointIndex(delta.start, parentActive);
                    startIndex = startIndex < 0 ? -startIndex - 1 : startIndex + 1;
                    let endIndex = ts.rangeList.pointIndex(delta.end, parentActive);
                    endIndex = endIndex < 0 ? -endIndex - 1 : endIndex - 1;
                    const toRemove = ts.rangeList.ranges.slice(startIndex, endIndex);
                    for (let j = 0; j < toRemove.length; j++) this.removeRange(toRemove[j]);
                }
                ts.rangeList.$onChange(delta);
            }
            const { session } = this.editor;
            if (!this.$inChange && isRemove && session.getLength() == 1 && !session.getValue()) this.detach();
        };
        this.updateLinkedFields = function () {
            const ts = this.selectedTabstop;
            if (!ts || !ts.hasLinkedRanges || !ts.firstNonLinked) return;
            this.$inChange = true;
            const { session } = this.editor;
            const text = session.getTextRange(ts.firstNonLinked);
            for (let i = 0; i < ts.length; i++) {
                const range = ts[i];
                if (!range.linked) continue;
                const { original } = range;
                const fmt = exports.snippetManager.tmStrFormat(text, original, this.editor);
                session.replace(range, fmt);
            }
            this.$inChange = false;
        };
        this.onAfterExec = function (e) {
            if (e.command && !e.command.readOnly) this.updateLinkedFields();
        };
        this.onChangeSelection = function () {
            if (!this.editor) return;
            const { lead } = this.editor.selection;
            const { anchor } = this.editor.selection;
            const isEmpty = this.editor.selection.isEmpty();
            for (let i = 0; i < this.ranges.length; i++) {
                if (this.ranges[i].linked) continue;
                const containsLead = this.ranges[i].contains(lead.row, lead.column);
                const containsAnchor = isEmpty || this.ranges[i].contains(anchor.row, anchor.column);
                if (containsLead && containsAnchor) return;
            }
            this.detach();
        };
        this.onChangeSession = function () {
            this.detach();
        };
        this.tabNext = function (dir) {
            const max = this.tabstops.length;
            let index = this.index + (dir || 1);
            index = Math.min(Math.max(index, 1), max);
            if (index == max) index = 0;
            this.selectTabstop(index);
            if (index === 0) this.detach();
        };
        this.selectTabstop = function (index) {
            this.$openTabstops = null;
            let ts = this.tabstops[this.index];
            if (ts) this.addTabstopMarkers(ts);
            this.index = index;
            ts = this.tabstops[this.index];
            if (!ts || !ts.length) return;

            this.selectedTabstop = ts;
            const range = ts.firstNonLinked || ts;
            if (!this.editor.inVirtualSelectionMode) {
                const sel = this.editor.multiSelect;
                sel.toSingleRange(range.clone());
                for (let i = 0; i < ts.length; i++) {
                    if (ts.hasLinkedRanges && ts[i].linked) continue;
                    sel.addRange(ts[i].clone(), true);
                }
                // todo investigate why is this needed
                if (sel.ranges[0]) sel.addRange(sel.ranges[0].clone());
            } else {
                this.editor.selection.setRange(range);
            }

            this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
            if (this.selectedTabstop && this.selectedTabstop.choices) this.editor.execCommand('startAutocomplete', { matches: this.selectedTabstop.choices });
        };
        this.addTabstops = function (tabstops, start, end) {
            const useLink = this.useLink || !this.editor.getOption('enableMultiselect');

            if (!this.$openTabstops) this.$openTabstops = [];
            // add final tabstop if missing
            if (!tabstops[0]) {
                const p = Range.fromPoints(end, end);
                moveRelative(p.start, start);
                moveRelative(p.end, start);
                tabstops[0] = [p];
                tabstops[0].index = 0;
            }

            const i = this.index;
            const arg = [i + 1, 0];
            const { ranges } = this;
            tabstops.forEach(function (ts, index) {
                const dest = this.$openTabstops[index] || ts;

                for (let i = 0; i < ts.length; i++) {
                    const p = ts[i];
                    const range = Range.fromPoints(p.start, p.end || p.start);
                    movePoint(range.start, start);
                    movePoint(range.end, start);
                    range.original = p;
                    range.tabstop = dest;
                    ranges.push(range);
                    if (dest != ts) dest.unshift(range);
                    else dest[i] = range;
                    if (p.fmtString || (dest.firstNonLinked && useLink)) {
                        range.linked = true;
                        dest.hasLinkedRanges = true;
                    } else if (!dest.firstNonLinked) dest.firstNonLinked = range;
                }
                if (!dest.firstNonLinked) dest.hasLinkedRanges = false;
                if (dest === ts) {
                    arg.push(dest);
                    this.$openTabstops[index] = dest;
                }
                this.addTabstopMarkers(dest);
                dest.rangeList = dest.rangeList || new RangeList();
                dest.rangeList.$bias = 0;
                dest.rangeList.addList(dest);
            }, this);

            if (arg.length > 2) {
            // when adding new snippet inside existing one, make sure 0 tabstop is at the end
                if (this.tabstops.length) arg.push(arg.splice(2, 1)[0]);
                this.tabstops.splice.apply(this.tabstops, arg);
            }
        };

        this.addTabstopMarkers = function (ts) {
            const { session } = this.editor;
            ts.forEach((range) => {
                if (!range.markerId) range.markerId = session.addMarker(range, 'ace_snippet-marker', 'text');
            });
        };
        this.removeTabstopMarkers = function (ts) {
            const { session } = this.editor;
            ts.forEach((range) => {
                session.removeMarker(range.markerId);
                range.markerId = null;
            });
        };
        this.removeRange = function (range) {
            let i = range.tabstop.indexOf(range);
            if (i != -1) range.tabstop.splice(i, 1);
            i = this.ranges.indexOf(range);
            if (i != -1) this.ranges.splice(i, 1);
            i = range.tabstop.rangeList.ranges.indexOf(range);
            if (i != -1) range.tabstop.splice(i, 1);
            this.editor.session.removeMarker(range.markerId);
            if (!range.tabstop.length) {
                i = this.tabstops.indexOf(range.tabstop);
                if (i != -1) this.tabstops.splice(i, 1);
                if (!this.tabstops.length) this.detach();
            }
        };

        this.keyboardHandler = new HashHandler();
        this.keyboardHandler.bindKeys({
            Tab(editor) {
                if (exports.snippetManager && exports.snippetManager.expandWithTab(editor)) return;
                editor.tabstopManager.tabNext(1);
                editor.renderer.scrollCursorIntoView();
            },
            'Shift-Tab': function (editor) {
                editor.tabstopManager.tabNext(-1);
                editor.renderer.scrollCursorIntoView();
            },
            Esc(editor) {
                editor.tabstopManager.detach();
            },
        });
    }).call(TabstopManager.prototype);


    var movePoint = function (point, diff) {
        if (point.row == 0) point.column += diff.column;
        point.row += diff.row;
    };

    var moveRelative = function (point, start) {
        if (point.row == start.row) point.column -= start.column;
        point.row -= start.row;
    };


    require('./lib/dom').importCssString('\
.ace_snippet-marker {\
    -moz-box-sizing: border-box;\
    box-sizing: border-box;\
    background: rgba(194, 193, 208, 0.09);\
    border: 1px dotted rgba(211, 208, 235, 0.62);\
    position: absolute;\
}');

    exports.snippetManager = new SnippetManager();


    const { Editor } = require('./editor');
    (function () {
        this.insertSnippet = function (content, options) {
            return exports.snippetManager.insertSnippet(this, content, options);
        };
        this.expandSnippet = function (options) {
            return exports.snippetManager.expandWithTab(this, options);
        };
    }).call(Editor.prototype);
});
