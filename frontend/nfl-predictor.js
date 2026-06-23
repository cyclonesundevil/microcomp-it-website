document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const state = {
        seasons: 10,
        model: 'baseline',
        playoffMode: false
    };

    const message = document.getElementById('nfl-message');
    const spreadRate = document.getElementById('spread-rate');
    const spreadDetail = document.getElementById('spread-detail');
    const totalRate = document.getElementById('total-rate');
    const totalDetail = document.getElementById('total-detail');
    const marginMae = document.getElementById('margin-mae');
    const totalMae = document.getElementById('total-mae');
    const tableBody = document.getElementById('season-table-body');
    const matchupForm = document.getElementById('matchup-form');
    const awayTeam = document.getElementById('away-team');
    const homeTeam = document.getElementById('home-team');
    const spreadLine = document.getElementById('spread-line');
    const totalLine = document.getElementById('total-line');
    const roofType = document.getElementById('roof-type');
    const divisionGame = document.getElementById('division-game');
    const dashboardMessage = document.getElementById('dashboard-message');
    const dashboardNotes = document.getElementById('dashboard-notes');
    const dashboardTeamCount = document.getElementById('dashboard-team-count');
    const dashboardSeason = document.getElementById('dashboard-season');
    const dashboardAvgPoints = document.getElementById('dashboard-avg-points');
    const dashboardTopTeam = document.getElementById('dashboard-top-team');
    const dashboardTopRating = document.getElementById('dashboard-top-rating');
    const dashboardTopPlayoff = document.getElementById('dashboard-top-playoff');
    const dashboardTopGrid = document.getElementById('dashboard-top-grid');
    const dashboardTableBody = document.getElementById('dashboard-table-body');
    const injuryTeam = document.getElementById('injury-team');
    const injuryImpact = document.getElementById('injury-impact');
    const injuryImpactValue = document.getElementById('injury-impact-value');
    const matchupLabel = document.getElementById('matchup-label');
    const matchupMargin = document.getElementById('matchup-margin');
    const matchupTotal = document.getElementById('matchup-total');
    const spreadPick = document.getElementById('spread-pick');
    const totalPick = document.getElementById('total-pick');
    const matchupNote = document.getElementById('matchup-note');
    const historyNote = document.getElementById('history-note');
    const historyTableBody = document.getElementById('history-table-body');
    let dashboardRefreshTimer = null;

    function pct(value) {
        if (value === null || value === undefined) return 'n/a';
        return `${(value * 100).toFixed(1)}%`;
    }

    function num(value) {
        if (value === null || value === undefined) return '--';
        return Number(value).toFixed(2);
    }

    function line(value) {
        if (value === null || value === undefined) return '--';
        const number = Number(value);
        if (number > 0) return `+${number.toFixed(1)}`;
        return number.toFixed(1);
    }

    function signed(value) {
        if (value === null || value === undefined) return '--';
        const number = Number(value);
        return number >= 0 ? `+${number.toFixed(1)}` : number.toFixed(1);
    }

    function totalResult(game) {
        const margin = Number(game.actual_total) - Number(game.total_line);
        if (Math.abs(margin) < 0.001) return { label: 'Push', className: 'result-push' };
        if (margin > 0) return { label: 'Over', className: 'result-over' };
        return { label: 'Under', className: 'result-under' };
    }

    function favoriteResult(game) {
        const spread = Number(game.home_spread);
        const homeMargin = Number(game.home_margin);
        if (Math.abs(spread) < 0.001) return { label: 'Pick em', className: 'result-push' };

        const coverMargin = homeMargin - spread;
        if (Math.abs(coverMargin) < 0.001) return { label: 'Push', className: 'result-push' };

        const homeFavorite = spread < 0;
        const favoriteCovered = homeFavorite ? coverMargin > 0 : coverMargin < 0;
        return favoriteCovered
            ? { label: 'Covered', className: 'result-covered' }
            : { label: 'Not covered', className: 'result-not-covered' };
    }

    function algorithmResult(result, pick, type) {
        if (!pick) return { label: 'No pick', className: 'result-push' };
        const pickLabel = type === 'spread'
            ? (pick === 'home' ? 'Home' : 'Away')
            : (pick === 'over' ? 'Over' : 'Under');
        if (result === 'correct') return { label: `${pickLabel} correct`, className: 'result-covered' };
        if (result === 'wrong') return { label: `${pickLabel} wrong`, className: 'result-not-covered' };
        if (result === 'push') return { label: `${pickLabel} push`, className: 'result-push' };
        return { label: 'No pick', className: 'result-push' };
    }

    function setLoading() {
        message.textContent = `Loading ${state.seasons}-year ${state.model} backtest...`;
        tableBody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    }

    function render(data) {
        const summary = data.summary;
        message.textContent = `${data.seasons}-year ${data.model} profile, spread edge ${data.thresholds.spread} points, total edge ${data.thresholds.total} points.`;
        spreadRate.textContent = pct(summary.spread_win_rate);
        spreadDetail.textContent = `${summary.spread_wins} wins, ${summary.spread_pushes} pushes, ${summary.spread_bets} picks`;
        totalRate.textContent = pct(summary.total_win_rate);
        totalDetail.textContent = `${summary.total_wins} wins, ${summary.total_pushes} pushes, ${summary.total_bets} picks`;
        marginMae.textContent = num(summary.margin_mae);
        totalMae.textContent = num(summary.total_mae);

        tableBody.innerHTML = data.by_season.map((row) => `
            <tr>
                <td>${row.season}</td>
                <td>${row.games}</td>
                <td>${row.spread_bets}</td>
                <td>${pct(row.spread_win_rate)}</td>
                <td>${row.total_bets}</td>
                <td>${pct(row.total_win_rate)}</td>
            </tr>
        `).join('');
    }

    function pickText(type, pick, prediction) {
        if (type === 'spread') {
            if (pick === 'home') return `${prediction.home_team} vs spread`;
            if (pick === 'away') return `${prediction.away_team} vs spread`;
        }
        if (pick === 'over') return 'Over';
        if (pick === 'under') return 'Under';
        return 'No edge';
    }

    function renderPrediction(prediction) {
        const homeBy = prediction.pred_margin;
        const total = prediction.pred_total;
        const favorite = homeBy >= 0 ? prediction.home_team : prediction.away_team;
        matchupLabel.textContent = `${prediction.away_team} at ${prediction.home_team}`;
        matchupMargin.textContent = `${favorite} by ${Math.abs(homeBy).toFixed(1)}`;
        matchupTotal.textContent = `Projected total: ${total.toFixed(1)} points`;
        spreadPick.textContent = pickText('spread', prediction.spread_pick, prediction);
        totalPick.textContent = pickText('total', prediction.total_pick, prediction);
        matchupNote.textContent = `Trained through ${prediction.latest_training_season}. Spread edge ${prediction.spread_edge.toFixed(1)}, total edge ${prediction.total_edge.toFixed(1)}.`;
    }

    function renderDashboard(data) {
        const dashboard = data.dashboard;
        const teams = dashboard.teams || [];
        const topTeams = dashboard.top_teams || teams.slice(0, 8);
        const top = teams[0];

        dashboardMessage.textContent = dashboard.playoff_mode
            ? `${dashboard.season} playoff mode after week ${dashboard.completed_week}. Neutral-site, recent-form, and expected-point-edge weights are emphasized.`
            : `${dashboard.season} model dashboard after week ${dashboard.completed_week}. Playoff odds are model-derived, not official league odds.`;
        const injuryNote = dashboard.injury?.applied
            ? [`High-impact injury adjustment: ${dashboard.injury.team} -${Number(dashboard.injury.impact).toFixed(1)} strength points`]
            : [];
        dashboardNotes.innerHTML = [...(dashboard.mode_notes || []), ...injuryNote].map((note) => `<span>${note}</span>`).join('');
        dashboardTeamCount.textContent = String(dashboard.league.team_count || teams.length);
        dashboardSeason.textContent = `Season ${dashboard.season}, week ${dashboard.completed_week}`;
        dashboardAvgPoints.textContent = num(dashboard.league.average_expected_points);
        dashboardTopTeam.textContent = top ? top.team : '--';
        dashboardTopRating.textContent = top ? `Strength ${signed(top.strength_rating)}` : '--';
        dashboardTopPlayoff.textContent = top ? pct(top.playoff_odds) : '--';

        dashboardTopGrid.innerHTML = topTeams.map((team) => `
            <div class="dashboard-card">
                <span>#${team.rank} ${team.team}</span>
                <strong>${signed(team.strength_rating)}</strong>
                <div class="dashboard-bars">
                    <label>Win probability <b>${pct(team.neutral_win_probability)}</b></label>
                    <div><i style="width:${Math.round(team.neutral_win_probability * 100)}%"></i></div>
                    <label>Playoff odds <b>${pct(team.playoff_odds)}</b></label>
                    <div><i style="width:${Math.round(team.playoff_odds * 100)}%"></i></div>
                </div>
            </div>
        `).join('');

        dashboardTableBody.innerHTML = teams.map((team) => `
            <tr>
                <td>${team.rank}</td>
                <td>${team.team}</td>
                <td>${signed(team.strength_rating)}</td>
                <td>${num(team.expected_points)}</td>
                <td>${num(team.expected_allowed)}</td>
                <td>${pct(team.neutral_win_probability)}</td>
                <td>${pct(team.playoff_odds)}</td>
                <td>${team.injury_adjustment ? `-${Number(team.injury_adjustment).toFixed(1)}` : '--'}</td>
                <td>${signed(team.recent_margin)}</td>
            </tr>
        `).join('');
    }

    function renderHistory(data) {
        historyNote.textContent = `${data.games.length} historical regular-season meeting${data.games.length === 1 ? '' : 's'} for ${data.away_team} and ${data.home_team}. Spreads, over/unders, and ${data.model} results are shown by year.`;
        if (!data.games.length) {
            historyTableBody.innerHTML = '<tr><td colspan="11">No historical regular-season meetings found.</td></tr>';
            return;
        }

        historyTableBody.innerHTML = data.games.map((game) => {
            const ou = totalResult(game);
            const favorite = favoriteResult(game);
            const algoSpread = algorithmResult(game.spread_result, game.spread_pick, 'spread');
            const algoTotal = algorithmResult(game.total_result, game.total_pick, 'total');
            return `
                <tr>
                    <td>${game.season}</td>
                    <td>${game.week}</td>
                    <td>${game.away_team} at ${game.home_team}</td>
                    <td>${game.home_team} ${line(game.home_spread)}</td>
                    <td>${data.home_team} ${line(game.selected_home_spread)}</td>
                    <td>${line(game.total_line)}</td>
                    <td><span class="result-pill ${ou.className}">${ou.label}</span></td>
                    <td><span class="result-pill ${favorite.className}">${favorite.label}</span></td>
                    <td><span class="result-pill ${algoSpread.className}">${algoSpread.label}</span></td>
                    <td><span class="result-pill ${algoTotal.className}">${algoTotal.label}</span></td>
                    <td>${game.away_team} ${Number(game.away_score).toFixed(0)}, ${game.home_team} ${Number(game.home_score).toFixed(0)}</td>
                </tr>
            `;
        }).join('');
    }

    async function loadTeams() {
        const response = await fetch(`${apiBase}/api/nfl/teams`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Unable to load teams');
        }

        const options = data.teams.map((team) => `<option value="${team}">${team}</option>`).join('');
        awayTeam.innerHTML = options;
        homeTeam.innerHTML = options;
        injuryTeam.innerHTML = `<option value="">No injury adjustment</option>${options}`;
        awayTeam.value = data.teams.includes('KC') ? 'KC' : data.teams[0];
        homeTeam.value = data.teams.includes('PHI') ? 'PHI' : data.teams[1];
    }

    async function loadPrediction() {
        matchupLabel.textContent = 'Calculating matchup...';
        const params = new URLSearchParams({
            away_team: awayTeam.value,
            home_team: homeTeam.value,
            spread_line: spreadLine.value || '0',
            total_line: totalLine.value || '44.5',
            model: state.model,
            roof: roofType.value,
            div_game: divisionGame.checked ? 'true' : 'false'
        });
        const response = await fetch(`${apiBase}/api/nfl/predict?${params.toString()}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Unable to predict matchup');
        }
        renderPrediction(data.prediction);
    }

    async function loadHistory() {
        historyNote.textContent = 'Loading historical casino lines...';
        historyTableBody.innerHTML = '<tr><td colspan="11">Loading...</td></tr>';
        const params = new URLSearchParams({
            away_team: awayTeam.value,
            home_team: homeTeam.value,
            model: state.model
        });
        const response = await fetch(`${apiBase}/api/nfl/history?${params.toString()}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Unable to load matchup history');
        }
        renderHistory(data);
    }

    async function loadBacktest() {
        setLoading();
        try {
            const params = new URLSearchParams({
                seasons: state.seasons,
                model: state.model
            });
            const response = await fetch(`${apiBase}/api/nfl/backtest?${params.toString()}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Backtest failed');
            }
            render(data);
        } catch (error) {
            message.textContent = `Unable to load the NFL backtest: ${error.message}`;
            tableBody.innerHTML = '<tr><td colspan="6">No results available.</td></tr>';
        }
    }

    async function loadDashboard() {
        dashboardMessage.textContent = `Loading ${state.model} dashboard...`;
        dashboardTableBody.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
        dashboardTopGrid.innerHTML = '<div class="dashboard-card loading-card">Loading team ratings...</div>';
        try {
            const params = new URLSearchParams({
                model: state.model,
                playoff_mode: state.playoffMode ? 'true' : 'false',
                injury_team: injuryTeam.value || '',
                injury_impact: injuryImpact.value || '0'
            });
            const response = await fetch(`${apiBase}/api/nfl/dashboard?${params.toString()}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Dashboard failed');
            }
            renderDashboard(data);
        } catch (error) {
            dashboardMessage.textContent = `Unable to load the NFL dashboard: ${error.message}`;
            dashboardTopGrid.innerHTML = '<div class="dashboard-card loading-card">No dashboard available.</div>';
            dashboardTableBody.innerHTML = '<tr><td colspan="9">No dashboard available.</td></tr>';
        }
    }

    function scheduleDashboardLoad() {
        window.clearTimeout(dashboardRefreshTimer);
        dashboardRefreshTimer = window.setTimeout(loadDashboard, 180);
    }

    async function refreshAll() {
        await Promise.all([loadBacktest(), loadDashboard()]);
        if (awayTeam.value && homeTeam.value) {
            try {
                await loadPrediction();
                await loadHistory();
            } catch (error) {
                matchupLabel.textContent = `Unable to predict matchup: ${error.message}`;
                matchupMargin.textContent = '--';
                matchupTotal.textContent = 'Projected total: --';
                spreadPick.textContent = '--';
                totalPick.textContent = '--';
                historyNote.textContent = `Unable to load historical lines: ${error.message}`;
                historyTableBody.innerHTML = '<tr><td colspan="11">No history available.</td></tr>';
            }
        }
    }

    document.querySelectorAll('[data-window]').forEach((button) => {
        button.addEventListener('click', () => {
            state.seasons = Number(button.dataset.window);
            document.querySelectorAll('[data-window]').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            loadBacktest();
        });
    });

    document.querySelectorAll('[data-model]').forEach((button) => {
        button.addEventListener('click', () => {
            state.model = button.dataset.model;
            document.querySelectorAll('[data-model]').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            refreshAll();
        });
    });

    document.querySelectorAll('[data-dashboard-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            state.playoffMode = button.dataset.dashboardMode === 'playoff';
            document.querySelectorAll('[data-dashboard-mode]').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            loadDashboard();
        });
    });

    injuryTeam.addEventListener('change', loadDashboard);
    injuryImpact.addEventListener('input', () => {
        injuryImpactValue.textContent = `${Number(injuryImpact.value).toFixed(1)} points`;
        scheduleDashboardLoad();
    });

    matchupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await loadPrediction();
            await loadHistory();
        } catch (error) {
            matchupLabel.textContent = `Unable to predict matchup: ${error.message}`;
            historyNote.textContent = `Unable to load historical lines: ${error.message}`;
        }
    });

    const stamp = document.querySelector('[data-build-stamp]');
    if (stamp) {
        const modified = new Date(document.lastModified);
        const datePart = modified.toLocaleDateString('en-US', {
            timeZone: 'America/Phoenix',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const timePart = modified.toLocaleTimeString('en-US', {
            timeZone: 'America/Phoenix',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        stamp.textContent = `Site updated: ${datePart} ${timePart} MST`;
    }

    loadTeams()
        .then(() => refreshAll())
        .catch((error) => {
            message.textContent = `Unable to initialize NFL demo: ${error.message}`;
            matchupLabel.textContent = `Unable to load teams: ${error.message}`;
        });
});
