from datetime import date, timedelta

import pytest
from test_api import client, reset_db, main_module, engine


@pytest.fixture(scope='module', autouse=True)
def close_connections():
    yield
    engine.dispose()


def log(day, weight, *, warmup=False):
    exercise = next(item for item in client.get('/api/v1/exercises').json() if item['muscle_group'] == 'Chest')
    response = client.post('/api/v1/workouts', json={
        'name': 'Training', 'performed_on': str(day),
        'exercises': [{'exercise_id': exercise['id'], 'sets': [{'weight': weight, 'reps': 10, 'is_warmup': warmup}]}],
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


def test_last_seven_days_crosses_week_boundary_and_counts_zero_volume_sessions(monkeypatch):
    class Tuesday(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 24)
    monkeypatch.setattr(main_module, 'date', Tuesday)
    reset_db()
    log(date(2026, 11, 17), 90)  # Eight calendar dates including today.
    log(date(2026, 11, 18), 20)
    log(date(2026, 11, 22), 50, warmup=True)

    result = client.get('/api/v1/dashboard').json()
    assert result['current_sessions'] == 0
    recent = result['last_seven_days']
    assert recent['sessions'] == 2
    assert recent['volume'] == 200
    assert {row['name']: row['volume'] for row in recent['volume_by_muscle_group'] if row['volume']} == {'Chest': 200}
    assert {'name': 'Pectoralis major', 'sets': 1} in recent['sets_by_muscle']
    assert all(row['sets'] == 1 for row in recent['sets_by_muscle'])
    assert client.get('/api/v1/dashboard?through_today=true').json()['last_seven_days'] == recent

    log(date(2026, 11, 24), 30)
    log(date(2026, 11, 25), 80)
    custom = client.get('/api/v1/dashboard?comparison=custom&compare_week=2026-11-23').json()
    recent = custom['last_seven_days']
    assert recent['sessions'] == 3
    assert recent['volume'] == 500
    assert {row['name']: row['volume'] for row in recent['volume_by_muscle_group'] if row['volume']} == {'Chest': 500}
    assert {'name': 'Pectoralis major', 'sets': 2} in recent['sets_by_muscle']
    assert client.get('/api/v1/dashboard?selected_week=2026-11-16').json()['last_seven_days'] is None


def test_heatmap_uses_the_last_seven_days_only_when_the_current_week_is_empty(monkeypatch):
    class Tuesday(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 24)

    monkeypatch.setattr(main_module, 'date', Tuesday)
    monkeypatch.setattr(main_module, 'WGER_MUSCLES', [
        {'id': 1, 'name_en': 'Chest', 'is_front': True, 'image_url_main': 'https://wger.de/chest.svg'},
    ])
    reset_db()
    log(date(2026, 11, 17), 90)
    log(date(2026, 11, 18), 20)
    log(date(2026, 11, 22), 30)
    url = '/api/v1/dashboard/body-map'

    current = client.get(f'{url}?selected_week=2026-11-23').json()
    assert current['showing_last_seven_days'] is True
    assert current['muscles'][0]['volume'] == 500
    through_today = client.get(f'{url}?through_today=true').json()
    assert through_today['showing_last_seven_days'] is True
    assert through_today['muscles'] == current['muscles']

    previous = client.get(f'{url}?selected_week=2026-11-16').json()
    assert previous['showing_last_seven_days'] is False
    assert previous['muscles'][0]['volume'] == 1400

    log(date(2026, 11, 24), 0)
    current = client.get(url).json()
    assert current['showing_last_seven_days'] is False
    assert current['muscles'][0]['volume'] == 10


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


def test_historical_heatmap_uses_saved_muscles_when_catalogue_changes(monkeypatch):
    reset_db()
    log(date(2026, 10, 12), 40)
    log(date(2026, 10, 18), 20)
    log(date(2026, 10, 19), 90)
    with main_module.SessionLocal() as db:
        exercise = db.scalar(main_module.select(main_module.Exercise).where(main_module.Exercise.muscle_group == 'Chest'))
        exercise.primary_muscle = 'Unmapped'
        exercise.muscle_group = None
        db.commit()
    monkeypatch.setattr(main_module, 'WGER_MUSCLES', [{'id':1,'name_en':'Chest','is_front':True,'image_url_main':'https://wger.de/chest.svg'}])
    previous = client.get('/api/v1/dashboard/body-map?selected_week=2026-10-12&through_today=true').json()
    current = client.get('/api/v1/dashboard/body-map?selected_week=2026-10-19').json()
    assert previous['muscles'][0]['volume'] == 600
    assert current['muscles'][0]['volume'] == 900
    assert previous['muscles'][0]['intensity'] == 1
    empty = client.get('/api/v1/dashboard/body-map?selected_week=2026-10-05').json()
    assert empty['muscles'] == []


def test_heatmap_artwork_fetch_can_recover_without_restarting_backend(monkeypatch):
    import httpx
    reset_db()
    log(date(2026, 10, 12), 40)
    monkeypatch.setattr(main_module, 'WGER_MUSCLES', None)
    attempts = []
    class CatalogueClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url, **kwargs):
            attempts.append(url)
            if len(attempts) == 1:
                raise httpx.ConnectError('Temporary artwork outage')
            return httpx.Response(200, request=httpx.Request('GET',url), json={'results':[{'id':1,'name_en':'Chest','is_front':True,'image_url_main':'https://wger.de/chest.svg'}]})
    monkeypatch.setattr(main_module.httpx, 'Client', CatalogueClient)
    first = client.get('/api/v1/dashboard/body-map?selected_week=2026-10-12')
    assert first.status_code == 503
    assert main_module.WGER_MUSCLES is None
    second = client.get('/api/v1/dashboard/body-map?selected_week=2026-10-12')
    assert second.status_code == 200
    assert second.json()['muscles'][0]['volume'] == 400
    assert len(attempts) == 2
