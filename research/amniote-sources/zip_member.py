"""List a remote zip's members, or stream the first N bytes (decompressed) of one member, with HTTP range
requests only: the archive itself is never downloaded (ToLaD#519). Used for vertlife's 1.9 GB Tonini 2016
posterior zip, to read one tree.

  python3 -I zip_member.py list <url>
  python3 -I zip_member.py head <url> <member> <n_bytes> <out_file>

Tonini 2016 draw 1 = the first line of `head <vertlife zip> squam_shl_new_Posterior_9755.1000.trees 1500000`.
Colston 2020 draw 1 = the first line of `curl -r 0-400000 https://zenodo.org/api/records/4986456/files/
archosauromorpha_PASTIS_386_10000.trees/content` (a plain text file, no zip).
"""
import re
import struct
import subprocess
import sys
import zlib

# curl, not urllib: urllib hung on data.vertlife.org where curl answered in under a second
CURL = ["curl", "-sS", "-L", "--max-time", "120", "-A", "ToLaD-research/1.0 (data-source survey)"]


def rng(url, a, b):
    return subprocess.run(CURL + ["-r", f"{a}-{b}", url], check=True, capture_output=True, stdin=subprocess.DEVNULL).stdout


def members(url):
    # A suffix range ("the last 64 KB"), with no HEAD first: on data.vertlife.org a range request sent right after a
    # HEAD hung, every time. The central directory sits just before the end records, so it is read from the tail.
    tail = subprocess.run(CURL + ["-r", "-65536", url], check=True, capture_output=True,
                          stdin=subprocess.DEVNULL).stdout
    i = tail.rfind(b"PK\x05\x06")
    cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
    end = i
    if cd_off == 0xFFFFFFFF:  # zip64
        end = tail.rfind(b"PK\x06\x06")
        cd_size, cd_off = struct.unpack("<QQ", tail[end + 40:end + 56])
    cd = tail[end - cd_size:end] if end >= cd_size else rng(url, cd_off, cd_off + cd_size - 1)
    out, p = [], 0
    while cd[p:p + 4] == b"PK\x01\x02":
        meth, = struct.unpack("<H", cd[p + 10:p + 12])
        csz, usz = struct.unpack("<II", cd[p + 20:p + 28])
        fl, el, cl = struct.unpack("<HHH", cd[p + 28:p + 34])
        off, = struct.unpack("<I", cd[p + 42:p + 46])
        name = cd[p + 46:p + 46 + fl].decode("utf-8", "replace")
        extra = cd[p + 46 + fl:p + 46 + fl + el]
        q = 0
        while q + 4 <= len(extra):  # zip64 extra field
            hid, hl = struct.unpack("<HH", extra[q:q + 4])
            if hid == 1:
                vals = list(struct.unpack("<" + "Q" * (hl // 8), extra[q + 4:q + 4 + hl]))
                if usz == 0xFFFFFFFF:
                    usz = vals.pop(0)
                if csz == 0xFFFFFFFF:
                    csz = vals.pop(0)
                if off == 0xFFFFFFFF:
                    off = vals.pop(0)
            q += 4 + hl
        out.append((name, meth, csz, usz, off))
        p += 46 + fl + el + cl
    return out


def head(url, member, nbytes, dest):
    ms = members(url)
    name, meth, csz, usz, off = next(m for m in ms if m[0] == member)
    lh = rng(url, off, off + 29)
    fl, el = struct.unpack("<HH", lh[26:30])
    start = off + 30 + fl + el
    d = zlib.decompressobj(-15) if meth == 8 else None
    got, pos = b"", start
    while len(got) < nbytes and pos < start + csz:
        chunk = rng(url, pos, min(pos + (1 << 22), start + csz) - 1)
        pos += len(chunk)
        got += d.decompress(chunk) if d else chunk
    open(dest, "wb").write(got[:nbytes])


if __name__ == "__main__":
    if sys.argv[1] == "list":
        for m in members(sys.argv[2]):
            print(m[2], m[3], m[0])
    else:
        head(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5])
