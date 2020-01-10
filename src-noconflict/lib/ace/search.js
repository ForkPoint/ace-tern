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
    const lang = require('./lib/lang');
    const oop = require('./lib/oop');
    const { Range } = require('./range');

    /**
 * @class Search
 *
 * A class designed to handle all sorts of text searches within a [[Document `Document`]].
 *
 * */

    /**
 *
 *
 * Creates a new `Search` object. The following search options are available:
 *
 * - `needle`: The string or regular expression you're looking for
 * - `backwards`: Whether to search backwards from where cursor currently is. Defaults to `false`.
 * - `wrap`: Whether to wrap the search back to the beginning when it hits the end. Defaults to `false`.
 * - `caseSensitive`: Whether the search ought to be case-sensitive. Defaults to `false`.
 * - `wholeWord`: Whether the search matches only on whole words. Defaults to `false`.
 * - `range`: The [[Range]] to search within. Set this to `null` for the whole document
 * - `regExp`: Whether the search is a regular expression or not. Defaults to `false`.
 * - `start`: The starting [[Range]] or cursor position to begin the search
 * - `skipCurrent`: Whether or not to include the current line in the search. Default to `false`.
 *
 * @constructor
 * */

    const Search = function () {
        this.$options = {};
    };

    (function () {
    /**
     * Sets the search options via the `options` parameter.
     * @param {Object} options An object containing all the new search properties
     *
     *
     * @returns {Search}
     * @chainable
    * */
        this.set = function (options) {
            oop.mixin(this.$options, options);
            return this;
        };

        /**
     * [Returns an object containing all the search options.]{: #Search.getOptions}
     * @returns {Object}
    * */
        this.getOptions = function () {
            return lang.copyObject(this.$options);
        };

        /**
     * Sets the search options via the `options` parameter.
     * @param {Object} An object containing all the search propertie
     * @related Search.set
    * */
        this.setOptions = function (options) {
            this.$options = options;
        };
        /**
     * Searches for `options.needle`. If found, this method returns the [[Range `Range`]] where the text first occurs. If `options.backwards` is `true`, the search goes backwards in the session.
     * @param {EditSession} session The session to search with
     *
     *
     * @returns {Range}
    * */
        this.find = function (session) {
            const options = this.$options;
            const iterator = this.$matchIterator(session, options);
            if (!iterator) return false;

            let firstRange = null;
            iterator.forEach((sr, sc, er, ec) => {
                firstRange = new Range(sr, sc, er, ec);
                if (sc == ec && options.start && options.start.start
                && options.skipCurrent != false && firstRange.isEqual(options.start)
                ) {
                    firstRange = null;
                    return false;
                }

                return true;
            });

            return firstRange;
        };

        /**
     * Searches for all occurrances `options.needle`. If found, this method returns an array of [[Range `Range`s]] where the text first occurs. If `options.backwards` is `true`, the search goes backwards in the session.
     * @param {EditSession} session The session to search with
     *
     *
     * @returns {[Range]}
    * */
        this.findAll = function (session) {
            const options = this.$options;
            if (!options.needle) return [];
            this.$assembleRegExp(options);

            const { range } = options;
            const lines = range
                ? session.getLines(range.start.row, range.end.row)
                : session.doc.getAllLines();

            let ranges = [];
            const { re } = options;
            if (options.$isMultiLine) {
                const len = re.length;
                const maxRow = lines.length - len;
                let prevRange;
                outer: for (let row = re.offset || 0; row <= maxRow; row++) {
                    for (var j = 0; j < len; j++) if (lines[row + j].search(re[j]) == -1) continue outer;

                    const startLine = lines[row];
                    const line = lines[row + len - 1];
                    const startIndex = startLine.length - startLine.match(re[0])[0].length;
                    const endIndex = line.match(re[len - 1])[0].length;

                    if (prevRange && prevRange.end.row === row
                    && prevRange.end.column > startIndex
                    ) {
                        continue;
                    }
                    ranges.push(prevRange = new Range(
                        row, startIndex, row + len - 1, endIndex,
                    ));
                    if (len > 2) row = row + len - 2;
                }
            } else {
                for (var i = 0; i < lines.length; i++) {
                    const matches = lang.getMatchOffsets(lines[i], re);
                    for (var j = 0; j < matches.length; j++) {
                        const match = matches[j];
                        ranges.push(new Range(i, match.offset, i, match.offset + match.length));
                    }
                }
            }

            if (range) {
                const startColumn = range.start.column;
                const endColumn = range.start.column;
                var i = 0; var
                    j = ranges.length - 1;
                while (i < j && ranges[i].start.column < startColumn && ranges[i].start.row == range.start.row) i++;

                while (i < j && ranges[j].end.column > endColumn && ranges[j].end.row == range.end.row) j--;

                ranges = ranges.slice(i, j + 1);
                for (i = 0, j = ranges.length; i < j; i++) {
                    ranges[i].start.row += range.start.row;
                    ranges[i].end.row += range.start.row;
                }
            }

            return ranges;
        };

        /**
     * Searches for `options.needle` in `input`, and, if found, replaces it with `replacement`.
     * @param {String} input The text to search in
     * @param {String} replacement The replacing text
     * + (String): If `options.regExp` is `true`, this function returns `input` with the replacement already made. Otherwise, this function just returns `replacement`.<br/>
     * If `options.needle` was not found, this function returns `null`.
     *
     *
     * @returns {String}
    * */
        this.replace = function (input, replacement) {
            const options = this.$options;

            const re = this.$assembleRegExp(options);
            if (options.$isMultiLine) return replacement;

            if (!re) return;

            const match = re.exec(input);
            if (!match || match[0].length != input.length) return null;

            replacement = input.replace(re, replacement);
            if (options.preserveCase) {
                replacement = replacement.split('');
                for (let i = Math.min(input.length, input.length); i--;) {
                    const ch = input[i];
                    if (ch && ch.toLowerCase() != ch) replacement[i] = replacement[i].toUpperCase();
                    else replacement[i] = replacement[i].toLowerCase();
                }
                replacement = replacement.join('');
            }

            return replacement;
        };

        this.$assembleRegExp = function (options, $disableFakeMultiline) {
            if (options.needle instanceof RegExp) return options.re = options.needle;

            let { needle } = options;

            if (!options.needle) return options.re = false;

            if (!options.regExp) needle = lang.escapeRegExp(needle);

            if (options.wholeWord) needle = addWordBoundary(needle, options);

            const modifier = options.caseSensitive ? 'gm' : 'gmi';

            options.$isMultiLine = !$disableFakeMultiline && /[\n\r]/.test(needle);
            if (options.$isMultiLine) return options.re = this.$assembleMultilineRegExp(needle, modifier);

            try {
                var re = new RegExp(needle, modifier);
            } catch (e) {
                re = false;
            }
            return options.re = re;
        };

        this.$assembleMultilineRegExp = function (needle, modifier) {
            const parts = needle.replace(/\r\n|\r|\n/g, '$\n^').split('\n');
            const re = [];
            for (let i = 0; i < parts.length; i++) {
                try {
                    re.push(new RegExp(parts[i], modifier));
                } catch (e) {
                    return false;
                }
            }
            return re;
        };

        this.$matchIterator = function (session, options) {
            const re = this.$assembleRegExp(options);
            if (!re) return false;
            const backwards = options.backwards == true;
            const skipCurrent = options.skipCurrent != false;

            const { range } = options;
            let { start } = options;
            if (!start) start = range ? range[backwards ? 'end' : 'start'] : session.selection.getRange();

            if (start.start) start = start[skipCurrent != backwards ? 'end' : 'start'];

            let firstRow = range ? range.start.row : 0;
            let lastRow = range ? range.end.row : session.getLength() - 1;

            if (backwards) {
                var forEach = function (callback) {
                    let { row } = start;
                    if (forEachInLine(row, start.column, callback)) return;
                    for (row--; row >= firstRow; row--) if (forEachInLine(row, Number.MAX_VALUE, callback)) return;
                    if (options.wrap == false) return;
                    for (row = lastRow, firstRow = start.row; row >= firstRow; row--) if (forEachInLine(row, Number.MAX_VALUE, callback)) return;
                };
            } else {
                var forEach = function (callback) {
                    let { row } = start;
                    if (forEachInLine(row, start.column, callback)) return;
                    for (row += 1; row <= lastRow; row++) if (forEachInLine(row, 0, callback)) return;
                    if (options.wrap == false) return;
                    for (row = firstRow, lastRow = start.row; row <= lastRow; row++) if (forEachInLine(row, 0, callback)) return;
                };
            }

            if (options.$isMultiLine) {
                const len = re.length;
                var forEachInLine = function (row, offset, callback) {
                    const startRow = backwards ? row - len + 1 : row;
                    if (startRow < 0) return;
                    let line = session.getLine(startRow);
                    const startIndex = line.search(re[0]);
                    if (!backwards && startIndex < offset || startIndex === -1) return;
                    for (let i = 1; i < len; i++) {
                        line = session.getLine(startRow + i);
                        if (line.search(re[i]) == -1) return;
                    }
                    const endIndex = line.match(re[len - 1])[0].length;
                    if (backwards && endIndex > offset) return;
                    if (callback(startRow, startIndex, startRow + len - 1, endIndex)) return true;
                };
            } else if (backwards) {
                var forEachInLine = function (row, endIndex, callback) {
                    const line = session.getLine(row);
                    const matches = [];
                    let m; let
                        last = 0;
                    re.lastIndex = 0;
                    while ((m = re.exec(line))) {
                        var { length } = m[0];
                        last = m.index;
                        if (!length) {
                            if (last >= line.length) break;
                            re.lastIndex = last += 1;
                        }
                        if (m.index + length > endIndex) break;
                        matches.push(m.index, length);
                    }
                    for (let i = matches.length - 1; i >= 0; i -= 2) {
                        const column = matches[i - 1];
                        var length = matches[i];
                        if (callback(row, column, row, column + length)) return true;
                    }
                };
            } else {
                var forEachInLine = function (row, startIndex, callback) {
                    const line = session.getLine(row);
                    let last;
                    let m;
                    re.lastIndex = startIndex;
                    while ((m = re.exec(line))) {
                        const { length } = m[0];
                        last = m.index;
                        if (callback(row, last, row, last + length)) return true;
                        if (!length) {
                            re.lastIndex = last += 1;
                            if (last >= line.length) return false;
                        }
                    }
                };
            }
            return { forEach };
        };
    }).call(Search.prototype);

    function addWordBoundary(needle, options) {
        function wordBoundary(c) {
            if (/\w/.test(c) || options.regExp) return '\\b';
            return '';
        }
        return wordBoundary(needle[0]) + needle
        + wordBoundary(needle[needle.length - 1]);
    }

    exports.Search = Search;
});
