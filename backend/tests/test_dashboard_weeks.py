from datetime import date, timedelta

import pytest
from test_api import client, reset_db, main_module, engine


@pytest.fixture(scope='module', autouse=True)
def close_connections():
    yield
    engine.dispose()


def log(day, weight):
    exercise = next(item for item in client.get('/api/v1/exercises').json() if item['muscle_group'] == 'Chest')
    response = client.post('/api/v1/workouts', json={
        'name': 'Training', 'performed_on': str(day),
        'exercises': [{'exercise_id': exercise['id'], 'sets': [{'weight': weight, 'reps': 10}]}],
    })
    assert response.status_code == 200


def test_selected_week_boundaries_and_custom_comparison():
    reset_db()
    log(date(2026, 9, 6), 10)
    log(date(2026, 9, 7), 20)
    log(date(2026, 9, 13), 30)
    log(date(2026, 9, 14), 40)
    result = client.get('/api/v1/dashboard?selected_week=2026-09-10').json()
    assert result['current_week_start'] == '2026-09-07'
    assert result['total_current_volume'] == 500
    assert result['total_previous_volume'] == 100
    assert result['current_sessions'] == 2
    custom = client.get('/api/v1/dashboard?selected_week=2026-09-07&comparison=custom&compare_week=2026-09-14').json()
    assert custom['total_previous_volume'] == 400
    assert client.get('/api/v1/dashboard?comparison=custom').status_code == 422
    empty = client.get('/api/v1/dashboard?selected_week=2025-01-01').json()
    assert empty['total_current_volume'] == 0


def test_four_week_average_includes_empty_weeks():
    reset_db()
    log(date(2026, 9, 7), 40)
    log(date(2026, 8, 31), 20)
    result = client.get('/api/v1/dashboard?selected_week=2026-09-14&comparison=average').json()
    assert result['total_previous_volume'] == 150
    assert result['previous_sessions'] == .5
    assert sum(row['last_week_sets'] for row in result['volume_by_muscle_group']) == .5


def test_through_today_matches_weekdays_and_body_map_bounds(monkeypatch):
    class Wednesday(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 14)
    monkeypatch.setattr(main_module, 'date', Wednesday)
    reset_db()
    today = main_module.date.today()
    monday = today - timedelta(days=today.weekday())
    log(monday - timedelta(days=7), 40)
    log(monday, 60)
    log(monday + timedelta(days=7), 100)
    if today.weekday() < 6:
        log(today - timedelta(days=6), 20)  # Next weekday in the previous week.
        log(today + timedelta(days=1), 30)
    result = client.get('/api/v1/dashboard?through_today=true').json()
    assert result['total_current_volume'] == 600
    assert result['total_previous_volume'] == 400
    previous_catalogue = main_module.WGER_MUSCLES
    main_module.WGER_MUSCLES = [{'id': 1, 'name_en': 'Pectoralis major', 'is_front': True, 'image_url_main': 'https://wger.de/chest.svg'}]
    try:
        historical = client.get(f'/api/v1/dashboard/body-map?selected_week={monday - timedelta(days=7)}').json()
        current = client.get(f'/api/v1/dashboard/body-map?selected_week={monday}&through_today=true').json()
        assert current['muscles']
        assert current['muscles'][0]['volume'] == 600
        assert historical['muscles'][0]['volume'] == (600 if today.weekday() < 6 else 400)
    finally:
        main_module.WGER_MUSCLES = previous_catalogue
