// Regex and constant definitions
const convertHeadingRe = /convert_h(\d+)/;
const lineWithContentRe = /^(.*)$/gm;
const whitespaceRe = /[\t ]+/g;
const allWhitespaceRe = /[\t \r\n]+/g;
const newlineWhitespaceRe = /[\t \r\n]*[\r\n][\t \r\n]*/g;
const htmlHeadingRe = /^h[1-6]$/;

const ATX = 'atx';
const ATX_CLOSED = 'atx_closed';
const UNDERLINED = 'underlined'; // also known as SETEXT

const SPACES = 'spaces';
const BACKSLASH = 'backslash';

const ASTERISK = '*';
const UNDERSCORE = '_';

const LSTRIP = 'lstrip';
const RSTRIP = 'rstrip';
const STRIP = 'strip';

//
// Helper functions
//

// chomp: if a string starts or ends with a space, record it separately
function chomp(text) {
    const prefix = (text && text[0] === ' ') ? ' ' : '';
    const suffix = (text && text[text.length - 1] === ' ') ? ' ' : '';
    const trimmed = text.trim();
    return [prefix, suffix, trimmed];
}

// findAncestor: traverse upward looking for an element whose tagName (lowercase)
// is one of the supplied names.
function findAncestor(el, tagNames) {
    let current = el.parentNode;
    while (current) {
        if (
            current.nodeType === Node.ELEMENT_NODE &&
            tagNames.includes(current.tagName.toLowerCase())
        ) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

// isBlockContent: returns true if the node is an element or non‑whitespace text.
function isBlockContent(node) {
    if (!node) return false;
    if (node.nodeType === Node.ELEMENT_NODE) return true;
    if (
        node.nodeType === Node.COMMENT_NODE ||
        node.nodeType === Node.DOCUMENT_TYPE_NODE
    )
        return false;
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim() !== '';
    return false;
}

function prevBlockContentSibling(node) {
    let sibling = node.previousSibling;
    while (sibling) {
        if (isBlockContent(sibling)) return sibling;
        sibling = sibling.previousSibling;
    }
    return null;
}

function nextBlockContentSibling(node) {
    let sibling = node.nextSibling;
    while (sibling) {
        if (isBlockContent(sibling)) return sibling;
        sibling = sibling.nextSibling;
    }
    return null;
}

// shouldRemoveWhitespaceInside: if the element is “block‐level”
function shouldRemoveWhitespaceInside(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (htmlHeadingRe.test(tag)) return true;
    return [
        'p',
        'blockquote',
        'article',
        'div',
        'section',
        'ol',
        'ul',
        'li',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'td',
        'th',
    ].includes(tag);
}

// shouldRemoveWhitespaceOutside: same plus <pre>
function shouldRemoveWhitespaceOutside(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return shouldRemoveWhitespaceInside(el) || el.tagName.toLowerCase() === 'pre';
}

// abstractInlineConversion: helper to wrap inline text (for tags like <b>, <em>, etc.)
function abstractInlineConversion(markupFn, context, el, text, convertAsInline) {
    if (findAncestor(el, ['pre', 'code', 'kbd', 'samp'])) {
        return text;
    }
    const [prefix, suffix, chompedText] = chomp(text);
    if (!chompedText) return '';
    const markupPrefix = markupFn.call(context);
    const markupSuffix =
        markupPrefix.startsWith('<') && markupPrefix.endsWith('>')
            ? `</${markupPrefix.slice(1)}`
            : markupPrefix;
    return prefix + markupPrefix + chompedText + markupSuffix + suffix;
}

// A simple word-wrap implementation for <p> wrapping.
function wordWrap(str, width) {
    const words = str.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + word).length > width) {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine += word + ' ';
        }
    }
    if (currentLine) {
        lines.push(currentLine.trim());
    }
    return lines.join('\n');
}

//
// MarkdownConverter class
//
class MarkdownConverter {
    constructor(options = {}) {
        // Set default options and merge with any provided overrides.
        this.options = Object.assign(
            {
                autolinks: true,
                bullets: '*+-',
                code_language: '',
                code_language_callback: null,
                convert: null,
                default_title: false,
                escape_asterisks: true,
                escape_underscores: true,
                escape_misc: false,
                heading_style: UNDERLINED,
                keep_inline_images_in: [],
                newline_style: SPACES,
                strip: null,
                strip_document: STRIP,
                strong_em_symbol: ASTERISK,
                sub_symbol: '',
                sup_symbol: '',
                table_infer_header: false,
                wrap: false,
                wrap_width: 80,
            },
            options
        );
        if (this.options.strip !== null && this.options.convert !== null) {
            throw new Error(
                'You may specify either tags to strip or tags to convert, but not both.'
            );
        }
    }

    // Main entry point: pass in a DOM node (or document fragment)
    convert(dom) {
        return this.processTag(dom, false);
    }

    // Recursively process a node
    processTag(node, convertAsInline) {
        let text = '';

        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        const convertChildrenAsInline =
            convertAsInline ||
            htmlHeadingRe.test(tag) ||
            (tag === 'td' || tag === 'th');

        const removeInside = shouldRemoveWhitespaceInside(node);

        function canIgnore(child) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                return false;
            }
            if (
                child.nodeType === Node.COMMENT_NODE ||
                child.nodeType === Node.DOCUMENT_TYPE_NODE
            ) {
                return true;
            }
            if (child.nodeType === Node.TEXT_NODE) {
                if (child.nodeValue.trim() !== '') {
                    return false;
                } 
                if (removeInside && (!child.previousSibling || !child.nextSibling)) {
                    return true;
                }
                if (
                    shouldRemoveWhitespaceOutside(child.previousSibling) ||
                    shouldRemoveWhitespaceOutside(child.nextSibling)
                ) {
                    return true;
                }
                return false;
            }
            return false;
        }

        const children = Array.from(node.childNodes).filter(child => !canIgnore(child));

        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += this.processText(child);
            } else {
                const textStrip = text.replace(/\n+$/, '');
                const newlinesLeft = text.length - textStrip.length;
                const nextText = this.processTag(child, convertChildrenAsInline);
                const nextTextStrip = nextText.replace(/^\n+/, '');
                const newlinesRight = nextText.length - nextTextStrip.length;
                const newlines = '\n'.repeat(Math.max(newlinesLeft, newlinesRight));
                text = textStrip + newlines + nextTextStrip;
            }
        }

        const funcName = "convert_" + (tag || node.nodeName).replace(/[\[\]:-]/g, "_");
        if (typeof this[funcName] === "function" && this.shouldConvertTag(tag)) {
            text = this[funcName](node, text, convertAsInline);
        } else if (/^h[1-6]$/.test(tag) && this.shouldConvertTag(tag)) {
            text = this._convert_hn(Number(tag.charAt(1)), node, text, convertAsInline);
        }

        return text;
    }

    // Process text nodes
    processText(node) {
        let text = node.nodeValue || "";
        if (!findAncestor(node, ["pre"])) {
            if (this.options.wrap) {
                text = text.replace(allWhitespaceRe, " ");
            } else {
                text = text.replace(newlineWhitespaceRe, "\n").replace(whitespaceRe, " ");
            }
        }
        if (!findAncestor(node, ["pre", "code", "kbd", "samp"])) {
            text = this.escape(text);
        }
        if (
            shouldRemoveWhitespaceOutside(node.previousSibling) ||
            (node.parentNode && shouldRemoveWhitespaceInside(node.parentNode) && !node.previousSibling)
        ) {
            text = text.replace(/^\s+/, "");
        }
        if (
            shouldRemoveWhitespaceOutside(node.nextSibling) ||
            (node.parentNode && shouldRemoveWhitespaceInside(node.parentNode) && !node.nextSibling)
        ) {
            text = text.replace(/\s+$/, "");
        }
        return text;
    }

    // Decide whether a tag should be converted (based on options.strip or options.convert)
    shouldConvertTag(tag) {
        const lowerTag = tag ? tag.toLowerCase() : "";
        if (this.options.strip !== null) {
            return !this.options.strip.includes(lowerTag);
        }
        if (this.options.convert !== null) {
            return this.options.convert.includes(lowerTag);
        }
        return true;
    }

    // Escape special characters as needed.
    escape(text) {
        if (!text) return "";
        if (this.options.escape_misc) {
            text = text
                .replace(/([\\&<`\[\]>~=+|])/g, "\\$1")
                .replace(/(\s|^)(-+(?:\s|$))/g, "$1\\$2")
                .replace(/(\s|^)(#{1,6}(?:\s|$))/g, "$1\\$2")
                .replace(/((?:\s|^)[0-9]{1,9})([.)](?:\s|$))/g, "$1\\$2");
        }
        if (this.options.escape_asterisks) {
            text = text.replace(/\*/g, "\\*");
        }
        if (this.options.escape_underscores) {
            text = text.replace(/_/g, "\\_");
        }
        return text;
    }

    // For underlined headings (setext style)
    underline(text, padChar) {
        text = (text || "").trimRight();
        return text ? `\n\n${text}\n${padChar.repeat(text.length)}\n\n` : "";
    }

    // Conversion methods for various tags

    convert_a(el, text, convertAsInline) {
        if (findAncestor(el, ["pre", "code", "kbd", "samp"])) return text;
        const [prefix, suffix, chompedText] = chomp(text);
        if (!chompedText) return "";
        const href = el.getAttribute("href");
        let title = el.getAttribute("title");
        if (
            this.options.autolinks &&
            chompedText.replace(/\\_/g, "_") === href &&
            !title &&
            !this.options.default_title
        ) {
            return `<${href}>`;
        }
        if (this.options.default_title && !title) {
            title = href;
        }
        const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
        return href ? `${prefix}[${chompedText}](${href}${titlePart})${suffix}` : text;
    }

    convert_b(el, text, convertAsInline) {
        return abstractInlineConversion(
            () => this.options.strong_em_symbol.repeat(2),
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_blockquote(el, text, convertAsInline) {
        text = (text || "").trim();
        if (convertAsInline) return " " + text + " ";
        if (!text) return "\n";
        text = text.replace(lineWithContentRe, (match, p1) => p1 ? "> " + p1 : ">");
        return "\n" + text + "\n\n";
    }

    convert_br(el, text, convertAsInline) {
        if (convertAsInline) return "";
        return this.options.newline_style.toLowerCase() === BACKSLASH
            ? "\\\n"
            : "  \n";
    }

    convert_code(el, text, convertAsInline) {
        if (
            el.parentNode &&
            el.parentNode.tagName &&
            el.parentNode.tagName.toLowerCase() === "pre"
        )
            return text;
        return abstractInlineConversion(
            ()=> "`",
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_del(el, text, convertAsInline) {
        return abstractInlineConversion(
            ()=> "~~",
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_div(el, text, convertAsInline) {
        if (convertAsInline) return " " + text.trim() + " ";
        text = text.trim();
        return text ? `\n\n${text}\n\n` : "";
    }

    convert_article(el, text, convertAsInline) {
        return this.convert_div(el, text, convertAsInline);
    }

    convert_section(el, text, convertAsInline) {
        return this.convert_div(el, text, convertAsInline);
    }

    convert_em(el, text, convertAsInline) {
        return abstractInlineConversion(
            () => this.options.strong_em_symbol,
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_kbd(el, text, convertAsInline) {
        return this.convert_code(el, text, convertAsInline);
    }

    convert_dd(el, text, convertAsInline) {
        text = (text || "").trim();
        if (convertAsInline) return " " + text + " ";
        if (!text) return "\n";
        text = text.replace(lineWithContentRe, (match, p1) => p1 ? "    " + p1 : "");
        text = ":" + text.slice(1);
        return `${text}\n`;
    }

    convert_dt(el, text, convertAsInline) {
        text = (text || "").trim();
        text = text.replace(allWhitespaceRe, " ");
        if (convertAsInline) return " " + text + " ";
        if (!text) return "\n";
        return `\n${text}\n`;
    }

    _convert_hn(n, el, text, convertAsInline) {
        if (convertAsInline) return text;
        n = Math.max(1, Math.min(6, n));
        const style = this.options.heading_style.toLowerCase();
        text = text.trim();
        if (style === UNDERLINED && n <= 2) {
            const line = n === 1 ? "=" : "-";
            return this.underline(text, line);
        }
        text = text.replace(allWhitespaceRe, " ");
        const hashes = "#".repeat(n);
        if (style === ATX_CLOSED) {
            return `\n\n${hashes} ${text} ${hashes}\n\n`;
        }
        return `\n\n${hashes} ${text}\n\n`;
    }

    convert_hr(el, text, convertAsInline) {
        return "\n\n---\n\n";
    }

    convert_i(el, text, convertAsInline) {
        return this.convert_em(el, text, convertAsInline);
    }

    convert_img(el, text, convertAsInline) {
        const alt = el.getAttribute("alt") || "";
        const src = el.getAttribute("src") || "";
        const title = el.getAttribute("title") || "";
        const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
        if (
            convertAsInline &&
            (!el.parentNode ||
                !this.options.keep_inline_images_in.includes(
                    el.parentNode.tagName.toLowerCase()
                ))
        ) {
            return alt;
        }
        return `![${alt}](${src}${titlePart})`;
    }

    convert_list(el, text, convertAsInline) {
        let nested = false;
        let beforeParagraph = false;
        const nextSibling = nextBlockContentSibling(el);
        if (
            nextSibling &&
            nextSibling.tagName &&
            !["ul", "ol"].includes(nextSibling.tagName.toLowerCase())
        ) {
            beforeParagraph = true;
        }
        let current = el;
        while (current) {
            if (current.tagName && current.tagName.toLowerCase() === "li") {
                nested = true;
                break;
            }
            current = current.parentNode;
        }
        if (nested) {
            return "\n" + text.replace(/\n+$/, "");
        }
        return "\n\n" + text + (beforeParagraph ? "\n" : "");
    }

    convert_ul(el, text, convertAsInline) {
        return this.convert_list(el, text, convertAsInline);
    }

    convert_ol(el, text, convertAsInline) {
        return this.convert_list(el, text, convertAsInline);
    }

    convert_li(el, text, convertAsInline) {
        text = (text || "").trim();
        if (!text) return "\n";
        const parent = el.parentNode;
        let bullet = "";
        if (
            parent &&
            parent.tagName &&
            parent.tagName.toLowerCase() === "ol"
        ) {
            const startAttr = parent.getAttribute("start");
            const start = startAttr && !Number.isNaN(startAttr) ? parseInt(startAttr, 10) : 1;
            const prevLis = Array.from(parent.children).filter(child => (
                    child.tagName &&
                    child.tagName.toLowerCase() === "li"
                )
            );
            const index = prevLis.indexOf(el);
            bullet = (start + index) + ".";
        } else {
            let depth = -1;
            let current = el;
            while (current) {
                if (
                    current.tagName &&
                    current.tagName.toLowerCase() === "ul"
                ) {
                    depth += 1;
                }
                current = current.parentNode;
            }
            const bullets = this.options.bullets;
            bullet = bullets[depth % bullets.length];
        }
        bullet = bullet + " ";
        const bulletWidth = bullet.length;
        const bulletIndent = " ".repeat(bulletWidth);
        text = text.replace(lineWithContentRe, (match, p1) => p1 ? bulletIndent + p1 : "");
        text = bullet + text.slice(bulletWidth);
        return `${text}\n`;
    }

    convert_p(el, text, convertAsInline) {
        if (convertAsInline) return " " + text.trim() + " ";
        text = text.trim();
        if (this.options.wrap) {
            if (this.options.wrap_width != null) {
                const lines = text.split("\n");
                const newLines = lines.map(line => wordWrap(line.trimStart(), this.options.wrap_width));
                text = newLines.join("\n");
            }
        }
        return text ? `\n\n${text}\n\n` : "";
    }

    convert_pre(el, text, convertAsInline) {
        if (!text) return "";
        let codeLang = this.options.code_language;
        if (this.options.code_language_callback) {
            codeLang = this.options.code_language_callback(el) || codeLang;
        }
        return `\n\n\`\`\`${codeLang}\n${text}\n\`\`\`\n\n`;
    }

    convert_script(el, text, convertAsInline) {
        return "";
    }

    convert_style(el, text, convertAsInline) {
        return "";
    }

    convert_s(el, text, convertAsInline) {
        return this.convert_del(el, text, convertAsInline);
    }

    convert_strong(el, text, convertAsInline) {
        return this.convert_b(el, text, convertAsInline);
    }

    convert_samp(el, text, convertAsInline) {
        return this.convert_code(el, text, convertAsInline);
    }

    convert_sub(el, text, convertAsInline) {
        return abstractInlineConversion(
            () => this.options.sub_symbol,
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_sup(el, text, convertAsInline) {
        return abstractInlineConversion(
            () => this.options.sup_symbol,
            this,
            el,
            text,
            convertAsInline
        );
    }

    convert_table(el, text, convertAsInline) {
        return "\n\n" + text.trim() + "\n\n";
    }

    convert_caption(el, text, convertAsInline) {
        return text.trim() + "\n\n";
    }

    convert_figcaption(el, text, convertAsInline) {
        return "\n\n" + text.trim() + "\n\n";
    }

    convert_td(el, text, convertAsInline) {
        let colspan = 1;
        const cs = el.getAttribute("colspan");
        if (cs && !Number.isNaN(cs)) {
            colspan = parseInt(cs, 10);
        }
        return " " + text.trim().replace(/\n/g, " ") + " |".repeat(colspan);
    }

    convert_th(el, text, convertAsInline) {
        let colspan = 1;
        const cs = el.getAttribute("colspan");
        if (cs && !Number.isNaN(cs)) {
            colspan = parseInt(cs, 10);
        }
        return " " + text.trim().replace(/\n/g, " ") + " |".repeat(colspan);
    }

    convert_tr(el, text, convertAsInline) {
        const cells = Array.from(el.children).filter(child => {
            const t = child.tagName ? child.tagName.toLowerCase() : "";
            return t === "td" || t === "th";
        });
        const isFirstRow = !el.previousElementSibling;
        const isHeadRow =
            cells.every(cell => cell.tagName && cell.tagName.toLowerCase() === "th") ||
            (el.parentNode &&
                el.parentNode.tagName &&
                el.parentNode.tagName.toLowerCase() === "thead" &&
                el.parentNode.children.length === 1);
        const isHeadRowMissing =
            (isFirstRow &&
                el.parentNode &&
                el.parentNode.tagName.toLowerCase() !== "tbody") ||
            (isFirstRow &&
                el.parentNode &&
                el.parentNode.tagName.toLowerCase() === "tbody" &&
                !el.parentNode.parentNode.querySelector("thead"));
        let overline = "";
        let underline = "";
        if ((isHeadRow || (isHeadRowMissing && this.options.table_infer_header)) && isFirstRow) {
            const fullColspan = cells.reduce((sum, cell) => {
                const cs = cell.getAttribute("colspan");
                return sum + (cs && !Number.isNaN(cs) ? parseInt(cs, 10) : 1);
            }, 0);
            underline += "| " + Array(fullColspan).fill("---").join(" | ") + " |\n";
        } else if (
            (isHeadRowMissing && !this.options.table_infer_header) ||
            (isFirstRow &&
                (el.parentNode.tagName.toLowerCase() === "table" ||
                    (el.parentNode.tagName.toLowerCase() === "tbody" && !el.parentNode.previousElementSibling)))
        ) {
            overline += "| " + Array(cells.length).fill("").join(" | ") + " |\n";
            overline += "| " + Array(cells.length).fill("___").join(" | ") + " |\n";
        }
        return overline + "|" + text + "\n" + underline;
    }
}

//
// Top-level markdownify function
//
function markdownify(dom, options = {}) {
    return new MarkdownConverter(options).convert(dom);
}

module.exports = markdownify;

// -----
// Usage Example:
//
// Suppose you have a DOM node (for example, document.body or any element):
//
//    const md = markdownify(document.body, { wrap: true, wrap_width: 80 });
//    console.log(md);
//
// This code converts the HTML DOM tree into Markdown text.
// -----
