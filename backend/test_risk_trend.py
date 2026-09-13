import unittest

from main import calculate_risk_trend_adjustment


def _history(progress_values, completion_dates):
    dates = [
        "2025-06-30 12:00:00",
        "2025-08-31 12:00:00",
        "2025-10-31 12:00:00",
        "2025-12-31 12:00:00",
        "2026-02-28 12:00:00",
    ]
    return [
        {
            "recorded_at": recorded_at,
            "physical_progress": progress,
            "revised_completion_date": completion_date,
        }
        for recorded_at, progress, completion_date in zip(dates, progress_values, completion_dates)
    ]


class RiskTrendTests(unittest.TestCase):
    def test_risk_trend_detects_declining_progress_velocity(self):
        result = calculate_risk_trend_adjustment(
            _history([35, 50, 58, 61, 62], ["2026-03-31"] * 5),
            current_progress=62,
            current_completion_date="2026-03-31",
        )

        self.assertTrue(result["declining_velocity"])
        self.assertEqual(result["risk_adjustment"], 5.2)
        self.assertEqual(result["delay_adjustment"], 0.03)
        self.assertIn("Historical progress velocity is declining", result["factors"])

    def test_risk_trend_detects_completion_extension(self):
        result = calculate_risk_trend_adjustment(
            _history(
                [35, 50, 58, 61, 62],
                ["2026-03-31", "2026-03-31", "2026-03-31", "2026-03-31", "2026-06-30"],
            ),
            current_progress=62,
            current_completion_date="2026-06-30",
        )

        self.assertEqual(result["extension_months"], 3.0)
        self.assertEqual(result["risk_adjustment"], 8.0)
        self.assertEqual(result["delay_adjustment"], 0.08)
        self.assertIn("Completion date extended by 3.0 months", result["factors"])


if __name__ == "__main__":
    unittest.main()