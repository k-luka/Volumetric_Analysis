from __future__ import annotations

import tempfile
import time
import unittest
import os
import socket
from types import SimpleNamespace
from pathlib import Path
from unittest import mock

import nibabel as nib
import numpy as np

try:
    from fastapi.testclient import TestClient
except Exception as exc:  # noqa: BLE001 - optional dependency in older environments
    raise unittest.SkipTest(f"FastAPI test dependencies are not installed: {exc}") from exc

from volumetric_analysis import web
from volumetric_analysis.run import write_report


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff"
    b"\xff?\x00\x05\xfe\x02\xfeA\xe2\x9d\xb3\x00\x00\x00\x00IEND\xaeB`\x82"
)


def write_test_scan(path: Path) -> None:
    image = nib.Nifti1Image(np.zeros((2, 2, 2), dtype=np.float32), np.eye(4))
    nib.save(image, path)


class WebApiTest(unittest.TestCase):
    def setUp(self) -> None:
        web.RUNS.clear()
        self.client = TestClient(web.create_app())

    def test_defaults_returns_local_paths_and_reports(self) -> None:
        response = self.client.get("/api/defaults")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("inputDir", data)
        self.assertIn("outputDir", data)
        self.assertIn("auto", data["deviceChoices"])
        self.assertIsInstance(data["reports"], list)

    def test_browser_url_uses_loopback_for_wildcard_hosts(self) -> None:
        self.assertEqual(web.browser_url("0.0.0.0", 8765), "http://127.0.0.1:8765")
        self.assertEqual(web.browser_url("127.0.0.1", 8766), "http://127.0.0.1:8766")

    def test_port_available_reports_bound_port(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = sock.getsockname()[1]
            self.assertFalse(web.port_available("127.0.0.1", port))

    def test_build_frontend_runs_npm_build(self) -> None:
        with mock.patch.object(web.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            web.build_frontend()

        run.assert_called_once()
        args = run.call_args.args[0]
        self.assertEqual(args[:3], ["npm", "--prefix", str(web.REPO_ROOT / "frontend")])
        self.assertEqual(args[-2:], ["run", "build"])

    def test_build_frontend_exits_on_failure(self) -> None:
        with mock.patch.object(web.subprocess, "run", return_value=SimpleNamespace(returncode=17)):
            with self.assertRaises(SystemExit) as ctx:
                web.build_frontend()

        self.assertEqual(ctx.exception.code, 17)

    def test_validate_scans_handles_missing_and_empty_folders(self) -> None:
        missing = self.client.post("/api/scans/validate", json={"inputDir": "/definitely/missing", "recursive": False})
        self.assertEqual(missing.status_code, 200)
        self.assertFalse(missing.json()["exists"])

        with tempfile.TemporaryDirectory() as tmp:
            empty = self.client.post("/api/scans/validate", json={"inputDir": tmp, "recursive": False})

        self.assertEqual(empty.status_code, 200)
        self.assertTrue(empty.json()["exists"])
        self.assertEqual(empty.json()["scanCount"], 0)
        self.assertEqual(empty.json()["readableCount"], 0)

    def test_validate_scans_reads_valid_nifti(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scan = Path(tmp, "scan.nii")
            write_test_scan(scan)

            response = self.client.post("/api/scans/validate", json={"inputDir": tmp, "recursive": False})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["exists"])
        self.assertEqual(data["scanCount"], 1)
        self.assertEqual(data["readableCount"], 1)
        self.assertEqual(data["problems"], [])

    def test_validate_scans_reports_unreadable_nifti(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "broken.nii").write_text("not a nifti", encoding="utf-8")

            response = self.client.post("/api/scans/validate", json={"inputDir": tmp, "recursive": False})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["exists"])
        self.assertEqual(data["scanCount"], 1)
        self.assertEqual(data["readableCount"], 0)
        self.assertEqual(data["problems"][0]["name"], "broken.nii")

    def test_validate_output_accepts_existing_and_creatable_folders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            existing = self.client.post("/api/output/validate", json={"outputDir": tmp})
            nested = self.client.post("/api/output/validate", json={"outputDir": str(Path(tmp, "new", "results"))})

        self.assertEqual(existing.status_code, 200)
        self.assertEqual(existing.json()["status"], "ok")
        self.assertTrue(existing.json()["exists"])
        self.assertTrue(existing.json()["canWrite"])

        self.assertEqual(nested.status_code, 200)
        self.assertEqual(nested.json()["status"], "ok")
        self.assertFalse(nested.json()["exists"])
        self.assertTrue(nested.json()["canCreate"])

    def test_validate_output_rejects_file_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            file_path = Path(tmp, "not_a_folder")
            file_path.write_text("content", encoding="utf-8")

            response = self.client.post("/api/output/validate", json={"outputDir": str(file_path)})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "error")
        self.assertIn("not a folder", response.json()["message"])

    def test_create_output_folder_creates_nested_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, "new", "results")

            response = self.client.post("/api/output/create", json={"outputDir": str(target)})

            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "ok")
            self.assertTrue(data["exists"])
            self.assertTrue(data["canWrite"])
            self.assertTrue(target.is_dir())

    def test_create_output_folder_reports_invalid_file_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            file_path = Path(tmp, "not_a_folder")
            file_path.write_text("content", encoding="utf-8")

            response = self.client.post("/api/output/create", json={"outputDir": str(file_path)})

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "error")
            self.assertIn("not a folder", response.json()["message"])

    def test_select_directory_returns_selected_local_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            selected = Path(tmp)
            with mock.patch.object(web, "select_directory", return_value=selected) as picker:
                response = self.client.post(
                    "/api/paths/select-directory",
                    json={"initialDir": "/starting/path", "title": "Select input folder"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"selected": True, "path": web.display_path(selected), "message": None})
        picker.assert_called_once_with("/starting/path", "Select input folder")

    def test_select_directory_handles_cancel(self) -> None:
        with mock.patch.object(web, "select_directory", return_value=None):
            response = self.client.post("/api/paths/select-directory", json={"initialDir": "", "title": "Select input folder"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["selected"], False)
        self.assertIsNone(response.json()["path"])
        self.assertEqual(response.json()["message"], "Folder selection canceled.")

    def test_select_directory_uses_macos_applescript_without_tk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = SimpleNamespace(returncode=0, stdout=f"{tmp}\n", stderr="")
            with mock.patch.object(web.platform, "system", return_value="Darwin"), mock.patch.object(web.subprocess, "run", return_value=result) as runner:
                selected = web.select_directory(tmp, "Select input folder")

        self.assertEqual(selected, Path(tmp).resolve())
        runner.assert_called_once()
        args = runner.call_args.args[0]
        self.assertEqual(args[:2], ["osascript", "-e"])
        self.assertIn("choose folder", args[2])

    def test_select_directory_returns_none_when_macos_picker_is_canceled(self) -> None:
        result = SimpleNamespace(returncode=1, stdout="", stderr="User canceled.")
        with mock.patch.object(web.platform, "system", return_value="Darwin"), mock.patch.object(web.subprocess, "run", return_value=result):
            selected = web.select_directory("", "Select input folder")

        self.assertIsNone(selected)

    def test_run_endpoint_rejects_empty_scan_folder(self) -> None:
        with tempfile.TemporaryDirectory() as input_tmp, tempfile.TemporaryDirectory() as output_tmp:
            response = self.client.post(
                "/api/runs",
                json={
                    "inputDir": input_tmp,
                    "outputDir": output_tmp,
                    "recursive": False,
                    "deviceChoice": "cpu",
                    "study": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("No .nii or .nii.gz scans", response.json()["detail"])

    def test_run_endpoint_rejects_blank_input_path(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            response = self.client.post(
                "/api/runs",
                json={
                    "inputDir": "   ",
                    "outputDir": output_tmp,
                    "recursive": False,
                    "deviceChoice": "cpu",
                    "study": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Select scans to analyze.")

    def test_run_endpoint_rejects_blank_output_path(self) -> None:
        with tempfile.TemporaryDirectory() as input_tmp:
            scan = Path(input_tmp, "scan.nii")
            write_test_scan(scan)

            response = self.client.post(
                "/api/runs",
                json={
                    "inputDir": input_tmp,
                    "outputDir": "   ",
                    "recursive": False,
                    "deviceChoice": "cpu",
                    "study": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Enter a results folder.")

    def test_run_endpoint_rejects_output_path_that_is_file(self) -> None:
        with tempfile.TemporaryDirectory() as input_tmp, tempfile.TemporaryDirectory() as output_tmp:
            scan = Path(input_tmp, "scan.nii")
            write_test_scan(scan)
            output_file = Path(output_tmp, "report_target")
            output_file.write_text("content", encoding="utf-8")

            response = self.client.post(
                "/api/runs",
                json={
                    "inputDir": input_tmp,
                    "outputDir": str(output_file),
                    "recursive": False,
                    "deviceChoice": "cpu",
                    "study": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("not a folder", response.json()["detail"])

    def test_validate_scans_reports_unreadable_input_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mode = Path(tmp).stat().st_mode
            os.chmod(tmp, 0)
            try:
                if os.access(tmp, os.R_OK | os.X_OK):
                    self.skipTest("Current user can still read chmod 0 directories.")
                response = self.client.post("/api/scans/validate", json={"inputDir": tmp, "recursive": False})
            finally:
                os.chmod(tmp, mode)

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["exists"])
        self.assertEqual(data["scanCount"], 0)
        self.assertEqual(data["readableCount"], 0)
        self.assertEqual(data["problems"][0]["error"], "Input folder is not readable.")

    def test_saved_report_detail_parses_existing_demo_output(self) -> None:
        reports = web.recent_reports()
        if not reports:
            self.skipTest("No saved reports are available in outputs/")

        response = self.client.get(f"/api/reports/{web.report_id(reports[0])}")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("scan", data)
        self.assertIn("metadata", data)
        self.assertIn("outputDir", data["metadata"])
        self.assertIn("reportPath", data["metadata"])
        self.assertIn("metrics", data)
        self.assertIn("structures", data)

    def test_run_endpoint_uses_background_worker_and_sse_events(self) -> None:
        with tempfile.TemporaryDirectory() as input_tmp, tempfile.TemporaryDirectory() as output_tmp:
            scan = Path(input_tmp, "scan.nii")
            write_test_scan(scan)

            def fake_run_analysis(cfg, progress=None, control=None):
                if progress is not None:
                    progress("scan_start", {"message": "[1/1] scan.nii - segmenting..."})
                    progress("scan_done", {"message": "done - 1.0 mL"})
                    progress("complete", {"message": "Analyzed 1 scan(s): 1 succeeded, 0 failed."})
                output_dir = Path(str(cfg.output_dir))
                Path(output_dir, "example_qc_color.png").write_bytes(PNG_1X1)
                rows = [
                    {
                        "filename": "scan.nii",
                        "path": str(scan),
                        "subject_id": "scan",
                        "input_spacing_mm": "1 x 1 x 1",
                        "segmentation_spacing_mm": "1 x 1 x 1",
                        "voxel_count": 1000,
                        "volume_mm3": 1000.0,
                        "volume_ml": 1.0,
                        "status": "ok",
                        "error": "",
                    }
                ]
                return write_report(rows, output_dir, "brain_volumes", "test")

            with mock.patch.object(web, "run_analysis", side_effect=fake_run_analysis):
                created = self.client.post(
                    "/api/runs",
                    json={
                        "inputDir": input_tmp,
                        "outputDir": output_tmp,
                        "recursive": False,
                        "deviceChoice": "cpu",
                        "study": {},
                    },
                )

                self.assertEqual(created.status_code, 200)
                run_id = created.json()["runId"]

                status = None
                for _ in range(50):
                    status = self.client.get(f"/api/runs/{run_id}").json()
                    if status["state"] == "complete":
                        break
                    time.sleep(0.05)

                self.assertIsNotNone(status)
                self.assertEqual(status["state"], "complete")
                self.assertTrue(status["reportId"])
                self.assertTrue(status["artifacts"]["xlsx"])
                self.assertFalse(status["artifacts"]["pdf"])
                self.assertTrue(status["artifacts"]["color"])

                detail = self.client.get(f"/api/reports/{status['reportId']}")
                self.assertEqual(detail.status_code, 200)
                report = detail.json()
                self.assertEqual(report["scan"]["subject"], "scan")
                self.assertEqual(report["summary"]["source"], "current_run")
                self.assertTrue(report["summary"]["temporary"])
                self.assertEqual(report["metadata"]["source"], "current_run")
                self.assertEqual(report["metadata"]["runState"], "complete")
                self.assertEqual(report["metadata"]["device"], "cpu")
                self.assertEqual(report["metadata"]["inputDir"], web.display_path(Path(input_tmp).resolve()))
                self.assertEqual(report["rows"][0]["status"], "ok")
                self.assertTrue(report["artifacts"]["xlsx"])
                self.assertIsNone(report["artifacts"]["pdf"])
                self.assertTrue(report["artifacts"]["color"])
                self.assertEqual(len(report["qc"]), 1)
                self.assertEqual(report["qc"][0]["subject"], "scan")
                self.assertTrue(report["qc"][0]["color"])

                reports = self.client.get("/api/reports")
                self.assertEqual(reports.status_code, 200)
                current_run = [item for item in reports.json() if item["id"] == status["reportId"]]
                self.assertEqual(len(current_run), 1)
                self.assertEqual(current_run[0]["source"], "current_run")
                self.assertTrue(current_run[0]["temporary"])

                pdf = self.client.get(f"/api/reports/{status['reportId']}/download/pdf")
                self.assertEqual(pdf.status_code, 404)

                events = self.client.get(f"/api/runs/{run_id}/events")
                self.assertEqual(events.status_code, 200)
                body = events.text
                self.assertIn("event: start", body)
                self.assertIn("event: report_written", body)
                self.assertIn("event: complete", body)

    def test_run_endpoint_uses_trimmed_output_path_for_analysis(self) -> None:
        with tempfile.TemporaryDirectory() as input_tmp, tempfile.TemporaryDirectory() as output_tmp:
            scan = Path(input_tmp, "scan.nii")
            write_test_scan(scan)
            output_dir = Path(output_tmp, "nested")
            captured: dict[str, str] = {}

            def fake_run_analysis(cfg, progress=None, control=None):
                captured["output_dir"] = str(cfg.output_dir)
                return write_report([], Path(str(cfg.output_dir)), "brain_volumes", "test")

            with mock.patch.object(web, "run_analysis", side_effect=fake_run_analysis):
                created = self.client.post(
                    "/api/runs",
                    json={
                        "inputDir": input_tmp,
                        "outputDir": f"  {output_dir}  ",
                        "recursive": False,
                        "deviceChoice": "cpu",
                        "study": {},
                    },
                )

                self.assertEqual(created.status_code, 200)
                run_id = created.json()["runId"]
                for _ in range(50):
                    status = self.client.get(f"/api/runs/{run_id}").json()
                    if status["state"] == "complete":
                        break
                    time.sleep(0.05)

        self.assertEqual(captured["output_dir"], str(output_dir.resolve()))

    def _stage_run_volumes(self, output_dir: Path, subject: str, *, anat: bool = True, seg: bool = True) -> Path:
        """Write a report under output_dir and stage fastsurfer .mgz files for subject."""
        report_path = write_report(
            [
                {
                    "filename": f"{subject}.nii.gz",
                    "path": str(output_dir / f"{subject}.nii.gz"),
                    "subject_id": subject,
                    "input_spacing_mm": "1 x 1 x 1",
                    "segmentation_spacing_mm": "1 x 1 x 1",
                    "voxel_count": 1000,
                    "volume_mm3": 1000.0,
                    "volume_ml": 1.0,
                    "status": "ok",
                    "error": "",
                }
            ],
            output_dir,
            "brain_volumes",
            "staged",
        )
        run_id = "_".join(report_path.stem.split("_")[-2:])
        mri = output_dir / "runs" / run_id / "fastsurfer" / subject / "mri"
        mri.mkdir(parents=True, exist_ok=True)
        if anat:
            (mri / "orig.mgz").write_bytes(b"fake-anat")
        if seg:
            (mri / web.SEGMENTATION_NAME).write_bytes(b"fake-seg")
        # Register the run so report_path_from_id accepts this out-of-tree report.
        record = web.RunRecord(
            id=f"staged-{subject}",
            request=web.RunRequest(inputDir="input", outputDir=str(output_dir), deviceChoice="cpu"),
            device="cpu",
            state="complete",
            report_path=report_path,
        )
        web.RUNS[record.id] = record
        return report_path

    def test_volume_route_returns_octet_stream_for_existing_file(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01")
            identifier = web.report_id(report_path)

            anat = self.client.get(f"/api/reports/{identifier}/volume/sub-01/anat")
            seg = self.client.get(f"/api/reports/{identifier}/volume/sub-01/seg")

        self.assertEqual(anat.status_code, 200)
        self.assertEqual(anat.headers["content-type"], "application/octet-stream")
        self.assertEqual(anat.content, b"fake-anat")
        self.assertEqual(seg.status_code, 200)
        self.assertEqual(seg.headers["content-type"], "application/octet-stream")
        self.assertEqual(seg.content, b"fake-seg")

    def test_volume_route_returns_404_for_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01", seg=False)
            identifier = web.report_id(report_path)

            missing_seg = self.client.get(f"/api/reports/{identifier}/volume/sub-01/seg")
            missing_subject = self.client.get(f"/api/reports/{identifier}/volume/sub-99/anat")
            bad_kind = self.client.get(f"/api/reports/{identifier}/volume/sub-01/other")

        self.assertEqual(missing_seg.status_code, 404)
        self.assertEqual(missing_subject.status_code, 404)
        self.assertEqual(bad_kind.status_code, 404)

    def test_volume_route_rejects_path_traversal_subject(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01")
            identifier = web.report_id(report_path)

            # A backslash form survives RFC 3986 dot-segment removal by the client,
            # so the request reaches the route and exercises the traversal guard.
            response = self.client.get(f"/api/reports/{identifier}/volume/..%5Cx/anat")

        self.assertEqual(response.status_code, 400)

    def test_report_detail_exposes_anat_and_seg_volume_urls(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01")
            identifier = web.report_id(report_path)

            response = self.client.get(f"/api/reports/{identifier}")

        self.assertEqual(response.status_code, 200)
        qc = response.json()["qc"]
        self.assertEqual(len(qc), 1)
        self.assertEqual(qc[0]["anat"], f"/api/reports/{identifier}/volume/sub-01/anat")
        self.assertEqual(qc[0]["seg"], f"/api/reports/{identifier}/volume/sub-01/seg")

    def test_build_qc_scans_leaves_volume_urls_null_when_files_missing(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01", anat=False, seg=False)
            identifier = web.report_id(report_path)
            df = web.read_report_df(report_path)

            scans = web.build_qc_scans(output_dir, identifier, df, report_path=report_path)

        self.assertEqual(len(scans), 1)
        self.assertIsNone(scans[0].anat)
        self.assertIsNone(scans[0].seg)

    def test_build_qc_scans_keeps_volume_urls_null_without_report_path(self) -> None:
        # When no report_path is supplied the run_id can't be resolved, so anat/seg
        # must stay null even though orig.mgz / seg .mgz are staged on disk.
        with tempfile.TemporaryDirectory() as output_tmp:
            output_dir = Path(output_tmp)
            report_path = self._stage_run_volumes(output_dir, "sub-01")
            identifier = web.report_id(report_path)
            df = web.read_report_df(report_path)

            scans = web.build_qc_scans(output_dir, identifier, df)

        self.assertEqual(len(scans), 1)
        self.assertIsNone(scans[0].anat)
        self.assertIsNone(scans[0].seg)

    def test_volume_route_handler_rejects_traversal_subjects_directly(self) -> None:
        # Bypass the test client (which normalizes "../" before it reaches the
        # route) and call the registered handler directly to exercise both the
        # explicit "/" check and the ".." substring guard.
        app = web.create_app()
        handler = next(
            route.endpoint
            for route in app.routes
            if getattr(route, "path", None) == "/api/reports/{identifier}/volume/{subject}/{kind}"
        )
        for subject in ("..", "a/b", "a..b"):
            with self.assertRaises(web.HTTPException) as ctx:
                handler(identifier="anything", subject=subject, kind="anat")
            self.assertEqual(ctx.exception.status_code, 400)

    def test_atlas_regions_endpoint_returns_catalog(self) -> None:
        response = self.client.get("/api/atlas/regions")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        # The served maxLabel MUST equal the frontend's segLut.SEG_MAX_LABEL
        # (2035). A mismatch sizes the recolor LUT too short -> black holes in the
        # overlay (the exact failure segLut.ts warns about). This pins the wire
        # value; the frontend constant is asserted equal to it in api.test.ts.
        self.assertEqual(data["maxLabel"], 2035)
        regions = data["regions"]
        self.assertEqual(len(regions), 16)
        for region in regions:
            self.assertEqual(set(region), {"key", "name", "group", "labels"})
            self.assertTrue(region["labels"])

    def test_atlas_regions_hippocampus_and_cortex_labels(self) -> None:
        data = self.client.get("/api/atlas/regions").json()
        by_name = {region["name"]: region for region in data["regions"]}

        self.assertEqual(by_name["Hippocampus"]["labels"], [17, 53])
        cortex = by_name["Cerebral cortex"]["labels"]
        for lid in (1000, 1035, 2000, 2035):
            self.assertIn(lid, cortex)

    def test_known_run_report_returns_not_found_after_file_is_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as output_tmp:
            report_path = write_report([], Path(output_tmp), "brain_volumes", "deleted")
            record = web.RunRecord(
                id="deleted",
                request=web.RunRequest(inputDir="input", outputDir=output_tmp, deviceChoice="cpu"),
                device="cpu",
                state="complete",
                report_path=report_path,
            )
            web.RUNS[record.id] = record
            identifier = web.report_id(report_path)
            report_path.unlink()

            response = self.client.get(f"/api/reports/{identifier}")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Report not found")


if __name__ == "__main__":
    unittest.main()
