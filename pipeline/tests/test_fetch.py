"""The fetcher's source sets and its range cuts, offline (ToLaD#535); the OTT Amniota cut on a synthetic taxonomy."""

from __future__ import annotations

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from tolad_pipeline import fetch, ott_amniota

LOCK = Path(__file__).resolve().parents[1] / "sources.lock.json"


class Sets(unittest.TestCase):
    def test_mammal_set_is_the_old_list(self):
        self.assertIs(fetch.SETS["mammals"], fetch.SOURCES)
        for items in fetch.SOURCES.values():
            for rel, _, _ in items:
                self.assertFalse(rel.startswith("amniotes/"), rel)

    def test_amniote_set_is_pinned_and_lives_under_amniotes(self):
        lock = json.loads(LOCK.read_text())
        shared = {rel for items in fetch.SOURCES.values() for rel, _, _ in items}
        for items in fetch.AMNIOTES.values():
            for rel, url, _ in items:
                self.assertTrue(rel.startswith("amniotes/") or rel in shared, rel)
                self.assertIn(rel, lock)
                self.assertEqual(lock[rel]["url"], url)
                self.assertNotIn("latest", url)
        for rel in ott_amniota.OUTPUTS:
            self.assertEqual(lock[rel]["derived_from"], "ott/ott3.7.3.tgz")
        for rel in list(fetch.RANGE_CUTS) + list(fetch.ZIP_MEMBERS):
            self.assertIn(rel, lock)


class Cuts(unittest.TestCase):
    def test_first_line_spans_chunks(self):
        self.assertEqual(fetch.first_line([b"(a,", b"b);\r\n(c", b",d);\n"]), b"(a,b);\r\n")
        with self.assertRaises(ValueError):
            fetch.first_line([b"(a,b);"])

    def test_pbdb_timer_zeroed_under_amniotes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.json"
            p.write_bytes(b'{\n"elapsed_time":0.652,\n"records": []}\n')
            fetch.normalize("amniotes/pbdb/amniota_species.json", p)
            self.assertEqual(p.read_bytes(), b'{\n"elapsed_time":0,\n"records": []}\n')
            p.write_bytes(b'{\n"elapsed_time":0.652,\n"records": []}\n')
            fetch.normalize("amniotes/avonet/x.json", p)
            self.assertIn(b"0.652", p.read_bytes())

    def test_remote_zip_member_by_ranges(self):
        line = b"(" + b",".join(b"t%d:1" % i for i in range(5000)) + b");\r\n"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("other.txt", b"x" * 1000)
            z.writestr("post.trees", line + b"(t0:2,t1:2);\r\n" * 100)
        blob = buf.getvalue()

        def rng(url, first, last=None):
            if first < 0:
                return blob[first:]
            return blob[first:None if last is None else last + 1]
        with mock.patch.object(fetch, "http_range", rng), mock.patch.object(fetch, "RANGE_CHUNK", 4096):
            self.assertEqual(fetch.first_line(fetch.remote_zip_member_chunks("u", "post.trees")), line)
            self.assertEqual(fetch.first_line(fetch.remote_file_chunks("u")), blob[:blob.index(b"\n") + 1])
            with self.assertRaises(KeyError):
                fetch.remote_zip_member("u", "missing")


class OttAmniota(unittest.TestCase):
    def test_cut(self):
        rows = [  # uid, parent, name, rank, flags
            (1, "", "life", "no rank", ""),
            (ott_amniota.AMNIOTA, 1, "Amniota", "no rank", ""),
            (244265, ott_amniota.AMNIOTA, "Mammalia", "class", ""),
            (10, 244265, "Felidae", "family", ""),
            (11, 10, "Felis", "genus", ""),
            (12, 11, "Felis catus", "species", ""),
            (ott_amniota.ARCHOSAURIA, ott_amniota.AMNIOTA, "Archosauria", "no rank", ""),
            (20, ott_amniota.ARCHOSAURIA, "Phytosauria", "order", "extinct"),
            (21, 20, "Rutiodon carolinensis", "species", "extinct"),
            (30, 1, "Amphibia", "class", ""),
        ]
        with tempfile.TemporaryDirectory() as d:
            raw = Path(d)
            (raw / "ott").mkdir()
            (raw / "ott" / "taxonomy.tsv").write_text(
                "uid\t|\tparent_uid\t|\tname\t|\trank\t|\tsourceinfo\t|\tuniqname\t|\tflags\t|\n"
                + "".join(f"{u}\t|\t{p}\t|\t{n}\t|\t{r}\t|\t\t|\t\t|\t{f}\t|\n" for u, p, n, r, f in rows))
            (raw / "ott" / "synonyms.tsv").write_text(
                "name\t|\tuid\t|\ttype\t|\tuniqname\t|\tsourceinfo\t|\n"
                "Felis domesticus\t|\t12\t|\t\t|\t\t|\t\t|\nRana x\t|\t30\t|\t\t|\t\t|\t\t|\n")
            c = ott_amniota.cut(raw)
            self.assertEqual((c["taxa"], c["species"], c["synonyms"]), (8, 2, 1))
            tax = [ln.split("\t") for ln in (raw / ott_amniota.TAXONOMY).read_text().splitlines()[1:]]
            by = {int(r[0]): r for r in tax}
            self.assertNotIn(30, by)
            self.assertEqual(by[12][5:], ["Mammalia", "11", "10"])
            self.assertEqual(by[21][5], "Archosauria other")
            self.assertEqual(by[ott_amniota.ARCHOSAURIA][5], "Archosauria")
            self.assertEqual((raw / ott_amniota.SYNONYMS).read_text(), "name\tuid\nFelis domesticus\t12\n")


if __name__ == "__main__":
    unittest.main()
