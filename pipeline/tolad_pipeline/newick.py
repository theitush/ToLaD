"""Minimal Newick / NEXUS reader (no dependencies, never evaluates input).

Handles quoted labels, branch lengths and BEAST/TreeAnnotator style
``[&key=value,...]`` comments (kept as a raw string on the node).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(eq=False)
class NNode:
    label: str | None = None
    length: float | None = None
    comment: str | None = None
    children: list["NNode"] = field(default_factory=list)
    parent: "NNode | None" = None

    def iter_preorder(self):
        stack = [self]
        while stack:
            n = stack.pop()
            yield n
            stack.extend(reversed(n.children))

    def iter_postorder(self):
        out = list(self.iter_preorder())
        return reversed(out)

    def leaves(self):
        return [n for n in self.iter_preorder() if not n.children]


def parse_newick(s: str) -> NNode:
    s = s.strip()
    i = 0
    n = len(s)
    root = NNode()
    cur = root
    stack: list[NNode] = []

    def read_label(i: int) -> tuple[str, int]:
        if s[i] == "'":
            j = i + 1
            buf = []
            while j < n:
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    break
                buf.append(s[j])
                j += 1
            return "".join(buf), j + 1
        j = i
        while j < n and s[j] not in "(),:;[":
            j += 1
        return s[i:j].strip(), j

    while i < n:
        c = s[i]
        if c == "(":
            child = NNode(parent=cur)
            cur.children.append(child)
            stack.append(cur)
            cur = child
            i += 1
        elif c == ",":
            parent = stack[-1]
            sib = NNode(parent=parent)
            parent.children.append(sib)
            cur = sib
            i += 1
        elif c == ")":
            cur = stack.pop()
            i += 1
        elif c == ":":
            j = i + 1
            while j < n and s[j] not in "(),;[":
                j += 1
            try:
                cur.length = float(s[i + 1:j])
            except ValueError:
                cur.length = None
            i = j
        elif c == "[":
            j = s.index("]", i)
            cur.comment = (cur.comment or "") + s[i + 1:j]
            i = j + 1
        elif c == ";":
            break
        elif c.isspace():
            i += 1
        else:
            lab, i = read_label(i)
            cur.label = lab
    # The first "(" opened a child of our placeholder root; unwrap it.
    if root.label is None and len(root.children) == 1 and not stack:
        r = root.children[0]
        r.parent = None
        return r
    return root


def parse_nexus_tree(text: str) -> NNode:
    """Return the first tree of a NEXUS file, with the Translate table applied."""
    m = re.search(r"begin\s+trees\s*;(.*?)end\s*;", text, re.S | re.I)
    if not m:
        raise ValueError("no trees block")
    block = m.group(1)
    translate: dict[str, str] = {}
    tm = re.search(r"translate(.*?);", block, re.S | re.I)
    if tm:
        for part in tm.group(1).split(","):
            bits = part.strip().split(None, 1)
            if len(bits) == 2:
                translate[bits[0]] = bits[1].strip().strip("'")
        block = block[tm.end():]
    tr = re.search(r"tree\s+[^=]+=\s*(?:\[&[RU]\])?\s*(.*)", block, re.S | re.I)
    if not tr:
        raise ValueError("no tree statement")
    root = parse_newick(tr.group(1))
    if translate:
        for nd in root.iter_preorder():
            if nd.label in translate:
                nd.label = translate[nd.label]
    return root


_KV = re.compile(r"([A-Za-z0-9_%.]+)=(\{[^}]*\}|[^,]*)")


def parse_comment(comment: str | None) -> dict[str, str]:
    if not comment:
        return {}
    c = comment.lstrip("&")
    return {k: v for k, v in _KV.findall(c)}
