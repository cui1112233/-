import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('repair', pathlib.Path(__file__).with_name('restore-member-models.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class ProjectionTest(unittest.TestCase):
    def test_projects_only_original_granted_model_kinds(self):
        catalog = [{'id': 'text', 'kind': 'text'}, {'id': 'video', 'kind': 'video'},
                   {'id': 'speech', 'kind': 'tts'}, {'id': 'unknown', 'kind': 'other'}]
        self.assertEqual(repair.project(catalog, ['text', 'tts']), [catalog[0], catalog[2]])

    def test_preserves_model_configuration_exactly(self):
        model = {'id': 'text', 'kind': 'text', 'credential': 'test-only', 'enabled': False}
        self.assertEqual(repair.project([model], ['text']), [model])


if __name__ == '__main__':
    unittest.main()
