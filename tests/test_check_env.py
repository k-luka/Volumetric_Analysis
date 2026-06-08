from __future__ import annotations

import unittest
from unittest import mock

from volumetric_analysis import check_env


class VersionInfo:
    def __init__(self, major: int, minor: int, micro: int):
        self.major = major
        self.minor = minor
        self.micro = micro

    def __getitem__(self, item):
        return (self.major, self.minor, self.micro)[item]


class CheckEnvTest(unittest.TestCase):
    def test_python_check_accepts_python_310(self) -> None:
        with mock.patch.object(check_env.sys, "version_info", VersionInfo(3, 10, 20)):
            result = check_env.python_check()

        self.assertEqual(result.status, "ok")
        self.assertIn("3.10.20", result.detail)

    def test_python_check_rejects_other_versions(self) -> None:
        with mock.patch.object(check_env.sys, "version_info", VersionInfo(3, 13, 7)):
            result = check_env.python_check()

        self.assertEqual(result.status, "fail")
        self.assertIn("expected Python 3.10", result.detail)

    def test_missing_import_message_names_requirements(self) -> None:
        with mock.patch("importlib.util.find_spec", return_value=None):
            result = check_env.import_check("missing_module", "missing-package")

        self.assertEqual(result.status, "fail")
        self.assertIn("requirements.txt", result.detail)


if __name__ == "__main__":
    unittest.main()
