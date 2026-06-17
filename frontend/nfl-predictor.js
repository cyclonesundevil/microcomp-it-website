document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const state = {
        seasons: 10,
        model: 'baseline'
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
    const matchupLabel = document.getElementById('matchup-label');
    const matchupMargin = document.getElementById('matchup-margin');
    const matchupTotal = document.getElementById('matchup-total');
    const spreadPick = document.getElementById('spread-pick');
    const totalPick = document.getElementById('total-pick');
    const matchupNote = document.getElementById('matchup-note');

    function pct(value) {
        if (value === null || value === undefined) return 'n/a';
        return `${(value * 100).toFixed(1)}%`;
    }

    function num(value) {
        if (value === null || value === undefined) return '--';
        return Number(value).toFixed(2);
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

    async function loadTeams() {
        const response = await fetch(`${apiBase}/api/nfl/teams`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Unable to load teams');
        }

        const options = data.teams.map((team) => `<option value="${team}">${team}</option>`).join('');
        awayTeam.innerHTML = options;
        homeTeam.innerHTML = options;
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

    async function refreshAll() {
        await loadBacktest();
        if (awayTeam.value && homeTeam.value) {
            try {
                await loadPrediction();
            } catch (error) {
                matchupLabel.textContent = `Unable to predict matchup: ${error.message}`;
                matchupMargin.textContent = '--';
                matchupTotal.textContent = 'Projected total: --';
                spreadPick.textContent = '--';
                totalPick.textContent = '--';
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

    matchupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await loadPrediction();
        } catch (error) {
            matchupLabel.textContent = `Unable to predict matchup: ${error.message}`;
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
