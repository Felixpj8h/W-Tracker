import type { Dash } from './types';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useState, useEffect } from 'react';

export function DashboardGreeting({ dash, history, historyLoaded, calendar, firstName }: { dash: Dash | null; history: Workout[]; historyLoaded: boolean; calendar?: CalendarMonth; firstName: string }) {
    const greeting = `Hello ${firstName}.`;
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayPlan = calendar?.days.find(day => day.date === date);
    const completedWorkouts = history.filter(entry => entry.completed);
    const calendarMessage = (() => {
        if (todayPlan === undefined) return greeting;
        if (todayPlan === null) return 'Enjoy the rest day.';
        if (todayPlan.status === 'completed') return `Today’s ${todayPlan.workout_name ?? todayPlan.routine_name ?? 'workout'} is complete. Great work!`;
        return todayPlan.routine_name ? `Ready for today’s ${todayPlan.routine_name} workout?` : 'Enjoy the rest day.';
    })();
    const current = dash?.total_current_volume ?? 0;
    const previous = dash?.total_previous_volume ?? 0;
    const groups = dash?.volume_by_muscle_group ?? [];
    const leadGroup = [...groups].sort((a, b) => b.current_week_volume - a.current_week_volume)[0];
    const loggedExercises = (completedWorkouts ?? []).flatMap(workout => workout.exercises.map(exercise => ({ ...exercise, workoutName: workout.name })));
    const featuredExercise = loggedExercises.length ? loggedExercises[(new Date().getDate() + loggedExercises.length) % loggedExercises.length] : null;
    const featuredReps = featuredExercise?.sets?.reduce((sum, set) => sum + set.reps, 0) ?? 0;
    const facts = [
        `${current.toLocaleString()} kg of training volume logged this week.`,
        previous > 0 ? `Your training volume is ${Math.abs(Math.round((current - previous) / previous * 100))}% ${current >= previous ? 'higher' : 'lower'} than last week.` : 'Your next completed session will unlock a weekly comparison.',
        dash?.latest_weight ? `Your current tracked weight is ${dash.latest_weight.weight.toFixed(1)} kg.` : 'Add a weigh-in to begin tracking your bodyweight trend.',
        leadGroup ? `${leadGroup.name} is your highest-volume muscle group this week.` : 'Log your first workout to see your muscle-group focus.',
        completedWorkouts?.length ? `You have completed ${completedWorkouts.length} workout${completedWorkouts.length === 1 ? '' : 's'} so far.` : 'Finish your first workout to start your completed-session count.',
        featuredExercise ? `${featuredReps} reps logged for ${featuredExercise.name}.` : 'A completed workout will unlock an exercise snapshot here.'
    ];
    const messages = [calendarMessage, ...facts];
    const factKey = messages.join('|');
    const [text, setText] = useState('');
    const backendReady = dash !== null && historyLoaded && calendar !== undefined;
    useEffect(() => {
        if (!backendReady) return;
        let timer: ReturnType<typeof setTimeout>;
        let character = 0;
        let message = 0;
        const type = (value: string) => {
            character = 0;
            const tick = () => {
                character += 1;
                setText(value.slice(0, character));
                if (character < value.length) timer = setTimeout(tick, 34);
                else timer = setTimeout(erase, 2100);
            };
            tick();
        };
        const erase = () => {
            const tick = () => {
                character -= 1;
                setText((message === 0 ? greeting : messages[message - 1]).slice(0, character));
                if (character > 0) timer = setTimeout(tick, 18);
                else {
                    message = message === messages.length ? 1 : message + 1;
                    timer = setTimeout(() => type(message === 0 ? greeting : messages[message - 1]), 260);
                }
            };
            tick();
        };
        setText('');
        timer = setTimeout(() => type(greeting), 280);
        return () => clearTimeout(timer);
    }, [backendReady, factKey, greeting]);
    return <p className="dashboard-greeting" aria-live="polite">{backendReady && <><span>{text}</span><i aria-hidden="true" /></>}</p>;
}
