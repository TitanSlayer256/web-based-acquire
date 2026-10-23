// These variables hold the game's changing state. The browser keeps this state
// in memory for the current page session; refreshing the page starts over.
let playerCount; // Number of players selected on the start screen.
let playerData = []; // Player records: names, cash, shares, and tiles in hand.
let gameBoardWidth = 12; // The board has twelve numbered columns.
let gameBoardHeight = 9; // The board has nine lettered rows.
let rowLetter = ["A", "B", "C", "D", "E", "F", "G", "H", "I"]; // Row labels used in tile names, such as 3C.
let gameBoard = []; // One object for every tile space, including its owner and status.
let smallInformation = []; // Share prices and bonuses for small companies by size.
let mediumInformation = []; // Share prices and bonuses for medium companies by size.
let largeInformation = []; // Share prices and bonuses for large companies by size.
let companies = []; // The seven companies and their current size, price, and shares.
let gameOver = false; // Prevents further play once final scoring has happened.
let currentPlayerIndex = 0; // Index into playerData for the player whose turn it is.
let selectedTileName = null; // Name of the hand tile currently selected for placement.
let pendingTurn = false; // True while a player must finish buying shares or resolving a merger.
let mergerState = null; // Temporary information needed while resolving a merger.
const title = document.getElementById("title"); // Cache the page heading so start/reset can change it.

// These colors are shared by board tiles, hand previews, and company markers.
const companyColors = {
    sackson: "#e57373",
    zeta: "#f4d35e",
    america: "#64b5f6",
    fusion: "#81c784",
    hydra: "#ffb74d",
    phoenix: "#ba68c8",
    quantum: "#4db6ac"
};

// Capitalize company names for people while keeping their lowercase IDs stable in game data.
function companyDisplayName(name) {
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

// #region Board and price table setup
// Create the 108 board spaces once. Tile ownership is reset when a new game starts.
for (let j = 0; j < gameBoardHeight; j++) {
    for (let i = 0; i < gameBoardWidth; i++) {
        gameBoard.push({
            name: i + 1 + rowLetter[j], // Combine the column number and row letter, such as "1A".
            row: j + 1, 
            column: i + 1,
            ownership: "unassigned", // Can be unassigned, board, hand, discarded, or a company name.
            holderId: null, // Identifies the player when this tile is in someone's hand.
            playability: "playable" // Recalculated when nearby companies change.
        });
    }
}

// Build the small-company reference table. Each row represents one possible company size.
// The variable j groups tile counts into the price bands used by these game rules.
for (let i = 2; i <= 41; i++) {
    let j = i;
    if(i >= 6 && i <= 10){j = 6}
    else if(i >= 11 && i <= 20){j = 7}
    else if(i >= 21 && i <= 30){j = 8}
    else if(i >= 31 && i <= 40){j = 9}
    else if(i == 41){j = 10};
    smallInformation.push({
        size: i,
        price: j * 100, // Share price is the price-band number multiplied by $100.
        majority: j * 1000, // Majority bonus is ten times the share price.
        minority : j * 500, // Second-place shareholder bonus.
        }
    );
}
// Medium companies use the same bonus pattern with their own size-to-price ranges.
// The stored size starts at i - 1 because these cards use a different starting offset.
for (let i = 3; i <= 42; i++) {
    let j = i;
    if(i >= 7 && i <= 11){j = 7}
    else if(i >= 12 && i <= 21){j = 8}
    else if(i >= 22 && i <= 31){j = 9}
    else if(i >= 32 && i <= 41){j = 10}
    else if(i == 42){j = 11};
    mediumInformation.push({
        size: i - 1,
        price: j * 100, // Current price for this company size.
        majority: j * 1000, // Majority shareholder payout for this size.
        minority : j * 500,
        }
    );
}
// Large companies have their own size-to-price ranges as well.
// Their card table uses i - 2 for the same reason the medium table uses i - 1.
for (let i = 4; i <= 43; i++) {
    let j = i;
    if(i >= 8 && i <= 12){j = 8}
    else if(i >= 13 && i <= 22){j = 9}
    else if(i >= 23 && i <= 32){j = 10}
    else if(i >= 33 && i <= 42){j = 11}
    else if(i == 43){j = 12};
    largeInformation.push({
        size: i - 2,
        price: j * 100, // Current price for this company size.
        majority: j * 1000, // Majority shareholder payout for this size.
        minority : j * 500,
        }
    );
}
// #endregion

// #region Company setup
// Company names are lowercase identifiers used in the game logic; the interface capitalizes them.
// Each record tracks its type, current board size, current price/bonuses, and unsold shares.
companies.push({
    name: "sackson",
    type: "small",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "zeta",
    type: "small",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "america",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "fusion",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "hydra",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "phoenix",
    type: "large",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "quantum",
    type: "large",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
}
);
// #endregion

// Switch from the player-count screen to the board after the Start Game button is pressed.
function startGame () {
    playerCount = Number(document.getElementById("playerSelect").value);
    document.getElementById("startScreen").style.display = "none";
    title.innerText = "Game Board";
    document.getElementById("gameBoardScreen").style.display = "block";
}
// Draw the clickable board grid and place one random starting tile for each player.
function initiateGameBoard(rows, columns) {
    const container = document.getElementById("grid-container");
    container.style.gridTemplateColumns = `repeat(${columns}, 50px)`;
    container.innerHTML = "";
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const name = `${column + 1}${rowLetter[row]}`;
            const box = document.createElement("button");
            box.type = "button";
            box.classList.add("box");
            box.textContent = name;
            box.id = name;
            box.setAttribute("aria-label", `Place selected tile at ${name}`);
            // Clicking a board space asks placeTile to place the currently selected hand tile there.
            box.addEventListener("click", () => placeTile(name));
            container.appendChild(box);
        }
    }
    for (let i = 0; i < playerCount; i++) {
        const seedTile = unassignedTile();
        if (seedTile) updateTileOwnership(seedTile, "board");
    }
}
// Pick a random tile still in the draw pool; discarded or placed tiles are excluded.
function unassignedTile() {
    const unassignedItems = gameBoard.filter(item => item.ownership === "unassigned");
    if (unassignedItems.length === 0) return null;
    return unassignedItems[Math.floor(Math.random() * unassignedItems.length)].name;
}
// Change a tile's owner and refresh its board appearance. Returns false for an unknown tile name.
function updateTileOwnership(itemName, newOwnership) {
    const item = gameBoard.find(tile => tile.name === itemName);
    if (!item) return false;
    item.ownership = newOwnership;
    item.holderId = null;
    renderBoard();
    return true;
}
// Ask for each player's name, give them starting cash, and deal six random tiles.
function initiatePlayerData() {
    playerData = [];
    for (let i = 0; i < playerCount; i++) {
        const enteredName = prompt(`Enter player ${i + 1}'s name:`);
        if (enteredName === null) return false;
        const playerName = enteredName.trim() || `Player ${i + 1}`;
        const playerTiles = [];
        const player = {
            id: i,
            name: playerName,
            money: 6000,
            shares: Object.fromEntries(companies.map(company => [company.name, 0])), // Each company starts with zero shares held.
            playerTiles
        };
        for (let j = 0; j < 6; j++) {
            const tile = unassignedTile();
            if (!tile) break;
            playerTiles.push(tile);
            const boardTile = gameBoard.find(item => item.name === tile);
            boardTile.ownership = "hand";
            boardTile.holderId = i;
        }
        playerData.push(player);
    }
    return true;
}
// Return the player record for the current turn.
function currentPlayer() {
    return playerData[currentPlayerIndex];
}
// At turn start, permanently discard hand tiles that would connect two safe companies,
// then draw replacements when any unassigned tiles remain.
function replaceUnplayableTilesAtTurnStart(player) {
    let replacedAny = false;
    let checkedNames = new Set(); // Avoid checking a tile again after it has been discarded.
    while (true) {
        for (const tileName of player.playerTiles) updateTilePlayability(tileName);
        const unplayableNames = player.playerTiles.filter(tileName => {
            const tile = gameBoard.find(item => item.name === tileName);
            return tile?.playability === "unplayable" && !checkedNames.has(tileName);
        });
        if (!unplayableNames.length) break;

        for (const tileName of unplayableNames) {
            checkedNames.add(tileName);
            const tile = gameBoard.find(item => item.name === tileName);
            player.playerTiles.splice(player.playerTiles.indexOf(tileName), 1);
            tile.ownership = "discarded"; // unassignedTile() only draws "unassigned" tiles.
            tile.holderId = null;

            const replacement = unassignedTile();
            if (replacement) {
                const replacementTile = gameBoard.find(item => item.name === replacement);
                replacementTile.ownership = "hand";
                replacementTile.holderId = player.id;
                player.playerTiles.push(replacement);
                replacedAny = true;
            }
        }
        if (!unassignedTile()) break;
    }
    return replacedAny;
}

// The active player may declare the end when one chain reaches 41 tiles or all are safe (11+).
function gameEndConditionMet() {
    const activeCompanies = companies.filter(company => company.size > 0);
    return activeCompanies.some(company => company.size >= 41) ||
        (activeCompanies.length > 0 && activeCompanies.every(company => company.size >= 11));
}

// Show the declaration button only when a condition is met and no merger is being resolved.
function updateEndGameButton() {
    const button = document.getElementById("endGameButton");
    if (button) button.style.display = !gameOver && !mergerState && gameEndConditionMet() ? "block" : "none";
}

// Confirm the declaration, pay final bonuses, sell shares in active companies, and show the winner.
function endGame() {
    if (gameOver || !gameEndConditionMet()) return;
    if (!confirm("Are you sure you want to end the game and calculate the final scores?")) return;

    gameOver = true;
    pendingTurn = false;
    selectedTileName = null;
    mergerState = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("endGameButton").style.display = "none";

    // Final settlements are processed from the smallest active company to the largest.
    const activeCompanies = companies.filter(company => company.size > 0).sort((a, b) => a.size - b.size);
    const settlement = [];
    // Pay majority/minority bonuses before cashing in company shares.
    for (const company of activeCompanies) {
        settlement.push(`${companyDisplayName(company.name)}: ${payMergerBonuses(company)}`);
    }
    // Exchange each player's shares in active companies for cash at the current share price.
    for (const company of activeCompanies) {
        for (const player of playerData) {
            const shares = player.shares[company.name] || 0;
            if (shares > 0) {
                player.money += shares * company.price;
                settlement.push(`${player.name} sold ${shares} ${companyDisplayName(company.name)} share${shares === 1 ? "" : "s"} for $${shares * company.price}.`);
            }
        }
    }
    // Remove all holdings from the final display; shares in companies already absorbed are worthless.
    for (const player of playerData) {
        for (const company of companies) player.shares[company.name] = 0;
    }

    // Find the top total. More than one player can share the win if totals are tied.
    const highestScore = Math.max(...playerData.map(player => player.money));
    const winners = playerData.filter(player => player.money === highestScore);
    const results = document.getElementById("gameOverResults");
    results.innerHTML = "";
    const winnerMessage = document.createElement("p");
    winnerMessage.textContent = winners.length > 1
        ? `The game is over. ${winners.map(player => player.name).join(" and ")} tie with $${highestScore}.`
        : `The game is over. ${winners[0].name} wins with $${highestScore}.`;
    results.appendChild(winnerMessage);
    for (const player of playerData) {
        const score = document.createElement("p");
        score.textContent = `${player.name}: $${player.money}`;
        results.appendChild(score);
    }
    if (settlement.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Show final payouts";
        const payoutList = document.createElement("ul");
        for (const entry of settlement) {
            const item = document.createElement("li");
            item.textContent = entry;
            payoutList.appendChild(item);
        }
        details.append(summary, payoutList);
        results.appendChild(details);
    }
    document.getElementById("gameOverArea").style.display = "block";
    document.getElementById("turnStatus").textContent = "Final scores have been calculated.";
    renderBoard();
    renderHand();
    renderEconomy();
}

// Prepare the screen for a new turn and quietly replace any tiles that became unplayable.
function takeTurn() {
    selectedTileName = null;
    pendingTurn = false;
    mergerState = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    const player = currentPlayer();
    if (!player) return;
    if (gameOver) return;
    replaceUnplayableTilesAtTurnStart(player);
    recalculatePlayability();
    document.getElementById("turnStatus").textContent = `${player.name}'s turn — choose one of their tiles, then click its highlighted board space.`;
    renderBoard();
    renderHand();
    renderEconomy();
}
// Select one of the current player's tiles before they click its matching board space.
function onSelectTile(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    const player = currentPlayer();
    if (pendingTurn || !tile || !player || tile.ownership !== "hand" || tile.holderId !== player.id) return;
    if (tile.playability === "unplayable") {
        document.getElementById("turnStatus").textContent = `${tileName} cannot be played because it would connect two safe companies.`;
        return;
    }
    selectedTileName = tileName;
    renderHand();
    renderBoard();
    document.getElementById("turnStatus").textContent = `${tileName} selected. Click the highlighted ${tileName} space to place it.`;
}
// Find the full connected area reached from a tile by walking through board tiles and companies.
// A breadth-first search ensures chains of several spaces are treated as one connected group.
function connectedTiles(startTile) {
    const found = new Set([startTile.name]);
    const queue = [startTile];
    while (queue.length) {
        for (const neighbor of getAdjacentTiles(queue.shift().name)) {
            // Hand, discarded, and empty spaces do not connect groups on the board.
            if (neighbor.ownership === "board" || companies.some(company => company.name === neighbor.ownership)) {
                if (!found.has(neighbor.name)) {
                    found.add(neighbor.name);
                    queue.push(neighbor);
                }
            }
        }
    }
    return [...found].map(name => gameBoard.find(tile => tile.name === name));
}
// Recount each company's tiles, then look up its price and bonuses for that size.
function syncCompanySizes() {
    for (const company of companies) {
        company.size = gameBoard.filter(tile => tile.ownership === company.name).length;
        // Select the correct reference table based on the company's size category.
        const table = company.type === "small" ? smallInformation : company.type === "medium" ? mediumInformation : largeInformation;
        const priceRow = table.find(row => row.size === company.size) || (company.size > 0 ? table[table.length - 1] : null);
        company.price = priceRow ? priceRow.price : 0;
        company.majority = priceRow ? priceRow.majority : 0;
        company.minority = priceRow ? priceRow.minority : 0;
    }
}
// Fill and open the shared dropdown dialog; return the selected company ID after it closes.
function chooseCompany(options, titleText) {
    const dialog = document.getElementById("companyChoiceDialog");
    const select = document.getElementById("companyChoiceSelect");
    document.getElementById("companyChoiceTitle").textContent = titleText;
    select.innerHTML = "";
    for (const company of options) {
        const option = document.createElement("option");
        option.value = company.name;
        option.textContent = companyDisplayName(company.name);
        select.appendChild(option);
    }
    dialog.returnValue = "";
    return new Promise(resolve => {
        // The dialog's Choose button returns the selected value; Cancel/Escape returns null.
        dialog.addEventListener("close", () => {
            resolve(dialog.returnValue === "choose" ? select.value : null);
        }, { once: true });
        dialog.showModal();
        select.focus();
    });
}

// Turn a newly connected group of unincorporated tiles into a company chosen from the dropdown.
async function foundCompany(component) {
    const available = companies.filter(company => company.size === 0);
    if (!available.length) return null;
    const selectedName = await chooseCompany(available, "Choose a company to start");
    const company = available.find(item => item.name === selectedName) || available[0];
    for (const tile of component) tile.ownership = company.name;
    const founder = currentPlayer();
    if (founder && company.sharesLeft > 0) {
        founder.shares[company.name] += 1;
        company.sharesLeft -= 1;
    }
    return company;
}
// Bonuses split between tied shareholders are rounded up to the next $100.
function roundUpToHundred(amount) {
    return Math.ceil(amount / 100) * 100;
}
// Pay a company's majority and minority bonuses using the shareholders' current share counts.
function payMergerBonuses(company) {
    const holders = playerData
        .map(player => ({ player, shares: player.shares[company.name] || 0 }))
        .filter(holder => holder.shares > 0)
        .sort((a, b) => b.shares - a.shares);
    if (!holders.length) return "No shareholder bonuses were due.";

    const topShares = holders[0].shares; // Holders are sorted from most shares to fewest.
    const primaryHolders = holders.filter(holder => holder.shares === topShares);
    // A tie for first place divides both bonuses among the tied top holders.
    if (primaryHolders.length > 1) {
        const payout = roundUpToHundred((company.majority + company.minority) / primaryHolders.length);
        primaryHolders.forEach(holder => { holder.player.money += payout; });
        return `Tied for majority: each of ${primaryHolders.map(holder => holder.player.name).join(", ")} received $${payout}.`;
    }

    const primary = primaryHolders[0];
    const secondPlace = holders.filter(holder => holder.player.id !== primary.player.id);
    // If nobody else owns shares, the only shareholder gets both bonuses.
    if (!secondPlace.length) {
        const payout = company.majority + company.minority;
        primary.player.money += payout;
        return `${primary.player.name} was the only shareholder and received both bonuses ($${payout}).`;
    }

    primary.player.money += company.majority;
    const secondShares = secondPlace[0].shares;
    const secondaryHolders = secondPlace.filter(holder => holder.shares === secondShares);
    const secondaryPayout = roundUpToHundred(company.minority / secondaryHolders.length);
    secondaryHolders.forEach(holder => { holder.player.money += secondaryPayout; });
    return `${primary.player.name} received the majority bonus ($${company.majority}); ${secondaryHolders.map(holder => holder.player.name).join(", ")} received $${secondaryPayout} each for the minority bonus.`;
}
// Save the tile group and involved companies, then begin resolving the merger one company at a time.
function startMerger(component, companyNames) {
    mergerState = {
        componentTileNames: component.map(tile => tile.name), // These spaces become part of the final surviving company.
        remainingCompanyNames: [...companyNames],
        mergerPlayerIndex: currentPlayerIndex, // Merger share decisions start with the player who caused it.
        survivorName: null,
        loserSnapshot: null,
        playerOrder: [],
        playerStep: 0
    };
    pendingTurn = true;
    selectedTileName = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    renderBoard();
    renderHand();
    startNextMerger();
}
// Select the survivor and largest loser for the next step of a multi-company merger.
async function startNextMerger() {
    const active = mergerState.remainingCompanyNames
        .map(name => companies.find(company => company.name === name))
        .filter(company => company && company.size > 0);
    if (active.length <= 1) {
        finishMergerSequence(active[0]);
        return;
    }

    // A safe company must survive. Otherwise the largest company survives; ties use the dropdown.
    const safeCompanies = active.filter(company => company.size >= 11);
    const largestSize = Math.max(...active.map(company => company.size));
    const largestCompanies = active.filter(company => company.size === largestSize);
    let survivor = safeCompanies[0] || largestCompanies[0];
    if (!safeCompanies.length && largestCompanies.length > 1) {
        const selectedName = await chooseCompany(largestCompanies, "Choose which company survives the tie");
        survivor = largestCompanies.find(company => company.name === selectedName) || largestCompanies[0];
    }
    // If several companies lose, handle the largest losing company first.
    const possibleLosers = active.filter(company => company.name !== survivor.name);
    possibleLosers.sort((a, b) => b.size - a.size);
    const loser = possibleLosers[0];
    mergerState.survivorName = survivor.name;
    // Store the loser's current price and bonuses before its size becomes zero.
    mergerState.loserSnapshot = {
        name: loser.name,
        size: loser.size,
        price: loser.price,
        majority: loser.majority,
        minority: loser.minority
    };
    // Visit players in turn order, starting with the player who played the merger tile.
    mergerState.playerOrder = playerData.map((player, offset) => playerData[(mergerState.mergerPlayerIndex + offset) % playerData.length]);
    mergerState.playerStep = 0;
    const bonusResult = payMergerBonuses(mergerState.loserSnapshot);
    document.getElementById("mergerTitle").textContent = `${companyDisplayName(loser.name)} is absorbed by ${companyDisplayName(survivor.name)}`;
    document.getElementById("mergerBonusSummary").textContent = `${companyDisplayName(loser.name)} had ${loser.size} tiles. Its share price was $${loser.price}. Bonuses: majority $${loser.majority}, minority $${loser.minority}. ${bonusResult}`;
    document.getElementById("mergerResolutionArea").style.display = "block";
    document.getElementById("turnStatus").textContent = `Merger in progress: resolve ${companyDisplayName(loser.name)}'s shares before continuing.`;
    renderBoard();
    renderEconomy();
    await showNextMergerPlayer();
}
// Find the next player with shares in the losing company and prepare their sell/trade controls.
async function showNextMergerPlayer() {
    const loserName = mergerState.loserSnapshot.name;
    while (mergerState.playerStep < mergerState.playerOrder.length) {
        const player = mergerState.playerOrder[mergerState.playerStep];
        const sharesHeld = player.shares[loserName] || 0;
        if (sharesHeld > 0) {
            const survivor = companies.find(company => company.name === mergerState.survivorName);
            // Two losing shares trade for one survivor share; available shares also limit the trade.
            const maxTrades = Math.min(Math.floor(sharesHeld / 2), survivor.sharesLeft);
            document.getElementById("mergerPlayerPrompt").textContent = `${player.name} has ${sharesHeld} ${companyDisplayName(loserName)} share${sharesHeld === 1 ? "" : "s"}. Sell any number, trade pairs for ${companyDisplayName(survivor.name)} shares (up to ${maxTrades}), or keep the rest.`;
            const sellInput = document.getElementById("mergerSellInput");
            const tradeInput = document.getElementById("mergerTradeInput");
            sellInput.value = "0";
            sellInput.max = String(sharesHeld);
            tradeInput.value = "0";
            tradeInput.max = String(maxTrades);
            sellInput.oninput = updateMergerHoldSummary;
            tradeInput.oninput = updateMergerHoldSummary;
            updateMergerHoldSummary();
            document.getElementById("resolveMergerPlayerButton").disabled = false;
            return;
        }
        mergerState.playerStep += 1;
    }
    await completeCurrentMerger();
}
// Preview how many losing-company shares remain after the entered sales and trades.
function updateMergerHoldSummary() {
    if (!mergerState) return;
    const player = mergerState.playerOrder[mergerState.playerStep];
    if (!player) return;
    const held = player.shares[mergerState.loserSnapshot.name] || 0;
    const sold = Number(document.getElementById("mergerSellInput").value) || 0;
    const traded = Number(document.getElementById("mergerTradeInput").value) || 0;
    const remaining = held - sold - traded * 2; // Each trade consumes two old shares.
    if (remaining < 0) {
        document.getElementById("mergerHoldSummary").textContent = "Sell and trade fewer shares than you hold.";
        return;
    }
    document.getElementById("mergerHoldSummary").textContent = `You will keep ${remaining} ${companyDisplayName(mergerState.loserSnapshot.name)} share${remaining === 1 ? "" : "s"}. Selling ${sold} pays $${sold * mergerState.loserSnapshot.price}; trading uses ${traded * 2} old shares.`;
}
// Validate and apply one shareholder's merger choices, then move to the next shareholder.
async function resolveMergerPlayer() {
    if (!mergerState) return;
    const player = mergerState.playerOrder[mergerState.playerStep];
    const loser = companies.find(company => company.name === mergerState.loserSnapshot.name);
    const survivor = companies.find(company => company.name === mergerState.survivorName);
    const held = player.shares[loser.name] || 0;
    const sold = Number(document.getElementById("mergerSellInput").value);
    const traded = Number(document.getElementById("mergerTradeInput").value);
    // Reject fractions, negative numbers, selling/trading more than held, or exceeding survivor stock.
    if (!Number.isInteger(sold) || !Number.isInteger(traded) || sold < 0 || traded < 0 || sold + traded * 2 > held || traded > survivor.sharesLeft) {
        document.getElementById("mergerHoldSummary").textContent = "Choose whole numbers that fit your share count and the surviving company's available shares.";
        return;
    }
    player.money += sold * mergerState.loserSnapshot.price;
    player.shares[loser.name] -= sold + traded * 2;
    player.shares[survivor.name] += traded;
    loser.sharesLeft += sold + traded * 2;
    survivor.sharesLeft -= traded;
    mergerState.playerStep += 1;
    renderEconomy();
    await showNextMergerPlayer();
}
// Move the losing company's board tiles to the survivor, then process any remaining losing companies.
async function completeCurrentMerger() {
    const loserName = mergerState.loserSnapshot.name;
    const survivorName = mergerState.survivorName;
    for (const tile of gameBoard) {
        if (tile.ownership === loserName) tile.ownership = survivorName;
    }
    mergerState.remainingCompanyNames = mergerState.remainingCompanyNames.filter(name => name !== loserName);
    syncCompanySizes();
    renderBoard();
    renderEconomy();
    document.getElementById("mergerResolutionArea").style.display = "none";
    await startNextMerger();
}
// Attach the tile that caused the merger to the final survivor, refresh the board, and resume the turn.
function finishMergerSequence(survivor) {
    if (!survivor) {
        mergerState = null;
        pendingTurn = false;
        showStockPurchase();
        return;
    }
    for (const tileName of mergerState.componentTileNames) {
        const tile = gameBoard.find(item => item.name === tileName);
        if (tile) tile.ownership = survivor.name;
    }
    const survivorName = survivor.name;
    mergerState = null;
    syncCompanySizes();
    recalculatePlayability();
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("turnStatus").textContent = `The merger is complete. ${companyDisplayName(survivorName)} survived. Buy up to 3 shares, then finish your turn.`;
    renderBoard();
    renderHand();
    renderEconomy();
    showStockPurchase();
}
// Companies are purchasable only if active, priced, and still have shares available.
function availableStockCompanies() {
    return companies.filter(company => company.size > 0 && company.sharesLeft > 0 && company.price > 0);
}
// Used to skip the purchase screen when the player cannot afford any available share.
function cheapestAvailableStockPrice() {
    const available = availableStockCompanies();
    return available.length ? Math.min(...available.map(company => company.price)) : null;
}
// Place the selected tile and decide whether it starts, grows, or merges companies.
async function placeTile(tileName) {
    const target = gameBoard.find(item => item.name === tileName);
    const player = currentPlayer();
    if (!target || !player || !selectedTileName || tileName !== selectedTileName) return;
    if (target.ownership !== "hand" || target.holderId !== player.id) return;
    if (target.playability === "unplayable") {
        document.getElementById("turnStatus").textContent = `${tileName} is not a legal space: it would connect two safe companies.`;
        return;
    }
    const handTile = target;
    const handIndex = player.playerTiles.indexOf(selectedTileName);
    if (handIndex < 0) return;

    handTile.ownership = "board";
    handTile.holderId = null;
    player.playerTiles.splice(handIndex, 1);
    // Inspect all board spaces connected to this placement to determine its effect.
    const component = connectedTiles(target);
    const touchingCompanies = [...new Set(component.map(tile => tile.ownership).filter(owner => companies.some(company => company.name === owner)))];
    let resultText = `${tileName} was placed.`;

    // A connected unincorporated group starts a company; a group with one company grows it.
    if (touchingCompanies.length === 0) {
        if (component.length > 1) {
            const newCompany = await foundCompany(component);
            resultText += newCompany ? ` ${companyDisplayName(newCompany.name)} was started.` : " No company was available, so the tiles remain unincorporated.";
        }
    } else if (touchingCompanies.length === 1) {
        for (const tile of component) tile.ownership = touchingCompanies[0];
        resultText += ` It joined ${companyDisplayName(touchingCompanies[0])}.`;
    } else {
        // Multiple companies trigger a merger unless the move would join two safe companies.
        const active = touchingCompanies.map(name => companies.find(company => company.name === name));
        const safe = active.filter(company => company.size >= 11);
        if (safe.length >= 2) {
            // This safety check should usually catch the tile before placement; restore it defensively.
            target.ownership = "unassigned";
            handTile.ownership = "hand";
            handTile.holderId = player.id;
            handTile.playability = "unplayable";
            player.playerTiles.splice(handIndex, 0, selectedTileName);
            resultText = `${tileName} was returned to your hand because it would connect two safe companies.`;
        } else {
            startMerger(component, touchingCompanies);
            return;
        }
    }

    syncCompanySizes();
    selectedTileName = null;
    // Successful placements end up owned by a company or as an unincorporated board tile.
    const placementSucceeded = handTile.ownership !== "hand";
    recalculatePlayability();
    document.getElementById("turnStatus").textContent = placementSucceeded
        ? `${resultText} Buy up to 3 shares, then finish your turn.`
        : `${resultText} Choose a different tile.`;
    renderBoard();
    renderHand();
    renderEconomy();
    if (placementSucceeded) showStockPurchase();
}
// Return the up/down/left/right neighbors of a named board space (diagonals do not connect).
function getAdjacentTiles(tile) {
    const item  = gameBoard.find(item => item.name === tile); // Find the item in the gameBoard array
    if (!item) return [];
    const row = item.row; // Get the row of the tile
    const column = item.column; // Get the column of the tile
    const adjacentTiles = []; // Create an array to hold the adjacent tiles
    const directions = [ // Only edge-sharing spaces count as neighbors in Acquire.
        { row: -1, column: 0 }, // Up
        { row: 1, column: 0 }, // Down
        { row: 0, column: -1 }, // Left
        { row: 0, column: 1 } // Right
    ];
    for (const direction of directions) { // Loop through each direction
        const newRow = row + direction.row; // Calculate the new row
        const newColumn = column + direction.column; // Calculate the new column
        if (newRow >= 1 && newRow <= gameBoardHeight && newColumn >= 1 && newColumn <= gameBoardWidth) { // Check if the new row and column are within bounds
            const adjacentTile = gameBoard.find(item => item.row === newRow && item.column === newColumn); // Find the adjacent tile in the gameBoard array
            if (adjacentTile) { // If the adjacent tile exists, add it to the array
                adjacentTiles.push(adjacentTile);
            }
        }
    }
    return adjacentTiles; // Return the array of adjacent tiles 
} 
// Mark a tile unplayable when placing it would connect two or more safe companies.
function updateTilePlayability(tile) {
    const item = gameBoard.find(boardTile => boardTile.name === tile);
    if (!item) return false;
    // Set removes duplicate company names when several of their tiles touch the same area.
    const connectedCompanies = [...new Set(connectedTiles(item)
        .map(connectedTile => companies.find(company => company.name === connectedTile.ownership))
        .filter(Boolean))];
    const safeCompanies = connectedCompanies.filter(company => company.size >= 11);
    item.playability = safeCompanies.length >= 2 ? "unplayable" : "playable";
    return item.playability;
}

// Used for hand previews: true when the tile would join unincorporated spaces but no company.
function wouldStartCompany(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    if (!tile) return false;
    const connected = connectedTiles(tile);
    const touchesUnincorporatedTile = connected.some(tile => tile.ownership === "board");
    const touchesCompany = connected.some(tile => companies.some(company => company.name === tile.ownership));
    return touchesUnincorporatedTile && !touchesCompany;
}

// Return the distinct companies that a tile would connect to if it were placed.
function companiesTileWouldTouch(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    if (!tile) return [];
    return [...new Set(connectedTiles(tile)
        .map(connectedTile => connectedTile.ownership)
        .filter(owner => companies.some(company => company.name === owner)))];
}

// Refresh legality for tiles in hands and the draw pool after board/company changes.
function recalculatePlayability() {
    for (const tile of gameBoard) {
        if (tile.ownership === "unassigned" || tile.ownership === "hand") updateTilePlayability(tile.name);
    }
}

// Copy the current board data into the HTML buttons, including color and click availability.
function renderBoard() {
    for (const tile of gameBoard) {
        const element = document.getElementById(tile.name);
        if (!element) continue;
        const company = companies.find(item => item.name === tile.ownership);
        // Company spaces use company colors, unincorporated spaces use gray, and empty spaces are white.
        element.style.backgroundColor = company ? companyColors[company.name] : tile.ownership === "board" ? "#999" : "white";
        element.classList.toggle("selected", tile.name === selectedTileName);
        element.disabled = gameOver || !selectedTileName || tile.name !== selectedTileName || tile.ownership !== "hand";
        element.title = tile.playability === "unplayable" ? "Cannot be played: connects two safe companies" : tile.ownership;
    }
}

// Rebuild the current player's hand and color each tile to preview the result of placing it.
function renderHand() {
    const hand = document.getElementById("playerHand");
    if (!hand) return;
    hand.innerHTML = "";
    const player = currentPlayer();
    if (!player) return;
    for (const tileName of player.playerTiles) {
        const tile = gameBoard.find(item => item.name === tileName);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hand-tile";
        button.textContent = tileName;
        button.disabled = gameOver || pendingTurn || tile?.playability === "unplayable";
        const touchedCompanyNames = companiesTileWouldTouch(tileName);
        // One company means growth; multiple colors mean a merger; gray means a new company.
        if (touchedCompanyNames.length === 1) {
            button.style.backgroundColor = companyColors[touchedCompanyNames[0]];
            button.title = `Playing this tile would add to ${companyDisplayName(touchedCompanyNames[0])}`;
        } else if (touchedCompanyNames.length > 1) {
            const slice = 100 / touchedCompanyNames.length; // Divide the circle evenly among merging companies.
            const colorStops = touchedCompanyNames.map((name, index) => {
                const start = index * slice;
                const end = (index + 1) * slice;
                return `${companyColors[name]} ${start}% ${end}%`;
            });
            button.style.backgroundImage = `conic-gradient(${colorStops.join(", ")})`;
            button.title = `Playing this tile would merge ${touchedCompanyNames.map(companyDisplayName).join(" and ")}`;
        } else if (tile && tile.playability !== "unplayable" && wouldStartCompany(tileName)) {
            button.classList.add("starts-company");
            button.title = "Playing this tile would start a company";
        }
        button.classList.toggle("selected", tileName === selectedTileName);
        button.addEventListener("click", () => onSelectTile(tileName));
        hand.appendChild(button);
    }
}

// Refresh player balances/share holdings, active company details, and the game-end button.
function renderEconomy() {
    const playersElement = document.getElementById("playerSummary");
    const companiesElement = document.getElementById("companySummary");
    if (!playersElement || !companiesElement) return;
    playersElement.innerHTML = "";
    for (const player of playerData) {
        const card = document.createElement("div");
        card.className = "summary-card";
        const holdings = Object.entries(player.shares).filter(([, count]) => count > 0).map(([name, count]) => `${companyDisplayName(name)}: ${count}`).join(", ") || "none";
        card.textContent = `${player.name}${player.id === currentPlayerIndex ? " (current)" : ""} — $${player.money} — shares: ${holdings}`;
        playersElement.appendChild(card);
    }
    companiesElement.innerHTML = "";
    const activeCompanies = companies.filter(company => company.size > 0);
    if (!activeCompanies.length) companiesElement.textContent = "No companies have been started.";
    for (const company of activeCompanies) {
        const card = document.createElement("div");
        card.className = "summary-card";
        const marker = document.createElement("span");
        marker.className = "company-color-dot";
        marker.style.backgroundColor = companyColors[company.name];
        marker.setAttribute("aria-hidden", "true");
        const details = document.createElement("span");
        details.textContent = `${companyDisplayName(company.name)} — ${company.size} tiles — $${company.price}/share — ${company.sharesLeft} shares left`;
        card.append(marker, details);
        companiesElement.appendChild(card);
    }
    updateEndGameButton();
}

// Show share options when possible; skip this phase if there are no shares or none are affordable.
function showStockPurchase() {
    const player = currentPlayer();
    const availableCompanies = availableStockCompanies();
    const cheapestPrice = cheapestAvailableStockPrice();
    if (!availableCompanies.length || cheapestPrice > player.money) {
        advanceTurn();
        return;
    }

    pendingTurn = true;
    const area = document.getElementById("stockPurchaseArea");
    const options = document.getElementById("stockPurchaseOptions");
    options.innerHTML = "";
    // Only display companies for which the player can currently afford at least one share.
    const affordableCompanies = availableCompanies.filter(company => company.price <= player.money);
    const activeCompanies = affordableCompanies;
    for (const company of activeCompanies) {
        const row = document.createElement("label");
        row.className = "purchase-row";
        const description = document.createElement("span");
        description.textContent = `${companyDisplayName(company.name)}: $${company.price} each (${company.sharesLeft} available)`;
        const marker = document.createElement("span");
        marker.className = "company-color-dot";
        marker.style.backgroundColor = companyColors[company.name];
        marker.setAttribute("aria-hidden", "true");
        const quantity = document.createElement("input");
        quantity.type = "number";
        quantity.min = "0";
        quantity.max = String(Math.min(3, company.sharesLeft));
        quantity.step = "1";
        quantity.value = "0";
        quantity.dataset.company = company.name;
        quantity.setAttribute("aria-label", `Number of ${companyDisplayName(company.name)} shares to buy`);
        quantity.addEventListener("input", updatePurchaseSummary);
        row.append(marker, description, quantity);
        options.appendChild(row);
    }
    area.style.display = "block";
    updatePurchaseSummary();
    renderHand();
}

// Recalculate the selected share count and cost as the player changes the quantity inputs.
function updatePurchaseSummary() {
    const player = currentPlayer();
    if (!player) return;
    let totalShares = 0;
    let totalCost = 0;
    for (const input of document.querySelectorAll("#stockPurchaseOptions input")) {
        const quantity = Math.max(0, Number(input.value) || 0);
        const company = companies.find(item => item.name === input.dataset.company);
        totalShares += quantity;
        totalCost += quantity * (company?.price || 0);
    }
    const message = `${totalShares} of 3 shares selected — total $${totalCost}; cash available: $${player.money}.`;
    document.getElementById("stockPurchaseSummary").textContent = message;
}

// Validate share purchases, subtract their cost, and hand the turn to the next player.
function finishTurn() {
    if (!pendingTurn) return;
    const player = currentPlayer();
    let purchases = [];
    let totalShares = 0;
    let totalCost = 0;
    // Validate every company quantity before changing any cash or share totals.
    for (const input of document.querySelectorAll("#stockPurchaseOptions input")) {
        const quantity = Number(input.value);
        const company = companies.find(item => item.name === input.dataset.company);
        if (!Number.isInteger(quantity) || quantity < 0 || !company || quantity > company.sharesLeft) {
            document.getElementById("stockPurchaseSummary").textContent = "Enter a whole number of shares that the company still has available.";
            return;
        }
        if (quantity > 0) purchases.push({ company, quantity });
        totalShares += quantity;
        totalCost += quantity * company.price;
    }
    if (totalShares > 3) {
        document.getElementById("stockPurchaseSummary").textContent = "You can buy at most 3 shares total per turn.";
        return;
    }
    if (totalCost > player.money) {
        document.getElementById("stockPurchaseSummary").textContent = "You do not have enough cash for that purchase.";
        return;
    }

    for (const { company, quantity } of purchases) {
        player.money -= quantity * company.price;
        player.shares[company.name] += quantity;
        company.sharesLeft -= quantity;
    }
    advanceTurn();
}

// Draw a replacement tile for the player who just played, then activate the next player.
function advanceTurn() {
    const player = currentPlayer();
    const replacement = unassignedTile();
    if (replacement) {
        const replacementTile = gameBoard.find(item => item.name === replacement);
        replacementTile.ownership = "hand";
        replacementTile.holderId = player.id;
        player.playerTiles.push(replacement);
    }
    currentPlayerIndex = (currentPlayerIndex + 1) % playerData.length;
    pendingTurn = false;
    mergerState = null;
    recalculatePlayability();
    renderEconomy();
    takeTurn();
}

// A fresh game resets all state, builds/deals the board, then begins with the first player.
document.getElementById("startGameButton").onclick = function() {
    // Reset existing tile objects so a second game can be started without reloading the page.
    gameBoard = gameBoard.map(tile => ({ ...tile, ownership: "unassigned", holderId: null, playability: "playable" }));
    playerData = [];
    // Companies return to their not-yet-founded state with all 25 shares available.
    companies.forEach(company => { company.size = 0; company.price = 0; company.majority = 0; company.minority = 0; company.sharesLeft = 25; });
    currentPlayerIndex = 0;
    selectedTileName = null;
    pendingTurn = false;
    mergerState = null;
    gameOver = false;
    document.getElementById("gameOverArea").style.display = "none";
    startGame();
    initiateGameBoard(gameBoardHeight, gameBoardWidth); // This initializes the game board
    // If a player cancels entering their name, return them to setup instead of starting half a game.
    if (!initiatePlayerData()) {
        document.getElementById("startScreen").style.display = "block";
        document.getElementById("gameBoardScreen").style.display = "none";
        title.innerText = "Welcome to Acquire Banking App";
        return;
    }
    syncCompanySizes();
    recalculatePlayability();
    takeTurn();
};
// Connect the page's action buttons to the functions that handle their clicks.
document.getElementById("finishTurnButton").onclick = finishTurn;
document.getElementById("resolveMergerPlayerButton").onclick = resolveMergerPlayer;
document.getElementById("endGameButton").onclick = endGame;
