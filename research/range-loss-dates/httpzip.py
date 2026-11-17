"""Read members of a remote zip over HTTP range requests, without downloading the whole archive.

Used for HYDE 3.2.1 (DANS, CC0): the baseline archive is 5.3 GB, but a few time slices of
cropland/grazing/urban are a few hundred MB. `python3 httpzip.py URL` lists the members.
"""
import io
import sys
import urllib.request
import zipfile


class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.pos = 0
        # a one-byte GET (the signed object-store URLs refuse HEAD): final URL and total size
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-0"}))
        self.real = r.geturl()  # the signed object-store URL the API redirects to
        self.size = int(r.headers["Content-Range"].split("/")[1])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.real, headers={"Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req, timeout=120).read()
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


def open_zip(url):
    return zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=1 << 22))


if __name__ == "__main__":
    z = open_zip(sys.argv[1])
    for i in z.infolist():
        print(i.filename, i.file_size, i.compress_size)
