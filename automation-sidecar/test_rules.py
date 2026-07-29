import unittest

from talentscreen_automation.profile import normalize_profile
from talentscreen_automation.rules import answer_for, best_option, find_best_country_option


class DeterministicRulesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = normalize_profile(
            {"basics": {"name": "Jane Candidate", "email": "jane@example.com",
                         "location": {"address": "Pleasanton, CA"}}},
            {"authorizedToWork": True, "requiresSponsorship": False,
             "willingToRelocate": True, "backgroundCheckConsent": True,
             "minimumSalary": "120000", "citizenship": "US Citizen",
                "securityClearance": "None"},
             
            "fallback@example.com",
        )

    def test_profile_is_normalized_without_sensitive_inference(self) -> None:
        self.assertEqual(self.profile.first_name, "Jane")
        self.assertEqual(self.profile.city, "Pleasanton")
        self.assertEqual(self.profile.state, "CA")
        self.assertIsNone(answer_for("Gender", self.profile))

    def test_explicit_boolean_answers_match_yes_no_questions(self) -> None:
        self.assertEqual(answer_for("Are you legally authorized to work in the US?", self.profile), "Yes")
        self.assertEqual(answer_for("Will you require employer sponsorship?", self.profile), "No")

    def test_native_and_custom_options_are_matched(self) -> None:
        self.assertEqual(best_option("Yes", ["Select...", "Yes", "No"]), "Yes")
        self.assertEqual(best_option("US", ["Choose", "Canada", "United States"]), "United States")

    def test_disability_auto_fill(self) -> None:
        self.assertEqual(answer_for("voluntary self identification of disability", self.profile), "No, I don't have a disability")
        opts = ["Yes, I have a disability", "No, I don't have a disability", "I don't wish to answer"]
        self.assertEqual(best_option(answer_for("disability", self.profile), opts), "No, I don't have a disability")

    def test_find_best_country_option(self) -> None:
        opts = ["United States +1", "Afghanistan +93", "American Samoa +1", "Canada +1"]
        self.assertEqual(find_best_country_option("+1 United States", opts), "United States +1")
        self.assertEqual(find_best_country_option("US", opts), "United States +1")

    def test_location_and_github_parsing(self) -> None:
        raw_resume = {
            "basics": {
                "name": "John Doe",
                "email": "john@example.com",
                "location": {
                    "address": "123 Main St, Houston, Texas, 77002, USA"
                },
                "profiles": [
                    {"network": "GitHub", "url": "https://github.com/johndoe"}
                ]
            }
        }
        profile = normalize_profile(raw_resume, {}, "fallback@example.com")
        self.assertEqual(profile.city, "Houston")
        self.assertEqual(profile.state, "Texas")
        self.assertEqual(profile.github, "https://github.com/johndoe")


if __name__ == "__main__":
    unittest.main()
