const puppeteer = require("puppeteer");
const readline = require("readline");

let browser;
let page;

const params = {};
process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.split("=");
    params[key] = value;
});

let {
    from = "ERYAMAN YHT",
    to = "SÖĞÜTLÜÇEŞME",
    wait = 2000,
    repeat: repeatParam
} = params;

const repeat = repeatParam === undefined 
    ? 5 
    : repeatParam === "inf" 
        ? -1 
        : Number(repeatParam);

let keepRunning = true;

// Terminalden input almak için
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

process.stdin.on("keypress", (str, key) => {
    if (key.name === "q") {
        keepRunning = false;
    }
});

process.on("SIGINT", async () => {
    keepRunning = false;

    if (browser) {
        await browser.close();
    }
    process.exit();
});

(async () => {
    let seferler = {};
    browser = await puppeteer.launch({
        headless: true,
        userDataDir: "./my-session",
    });
    page = await browser.newPage();
    await page.setViewport({
        width: 1920,
        height: 1080,
    });

    console.log("sayfa yükleniyor...");
    await page.goto("https://ebilet.tcddtasimacilik.gov.tr/");

    // KALKIŞ
    await page.waitForSelector("#fromTrainInput");
    await page.type("#fromTrainInput", from, { delay: 30 });

    await page.waitForSelector(".allStations .dropdown-item.station");
    const firstStationButton = await page.$(
        ".allStations .dropdown-item.station"
    );

    if (firstStationButton) {
        await firstStationButton.click();
        console.log(`Kalkış istasyonu seçildi (${from})`);
    } else {
        console.log("Kalkış istasyonu bulunamadı");
    }

    await new Promise((resolve) => setTimeout(resolve, 400));

    //VARIŞ
    await page.type("#toTrainInput", to, { delay: 30 });

    const stationButtons = await page.$$(".allStations .dropdown-item.station");

    for (const btn of stationButtons) {
        const location = await btn.$eval(".textLocation", (el) => el.innerText);
        if (location.includes(to)) {
            await btn.evaluate((b) => b.click());
            console.log(`Varış seçildi ✅ (${to})`);
            break;
        }
    }

    //TARİH
    const buttons = await page.$$(".dateSelectionTextArea .btn");

    for (const button of buttons) {
        const text = await button.evaluate((el) => el.innerText.trim());
        if (text === "Yarın") {
            await button.evaluate((b) => b.click());
            console.log("Yarın için...");
            break;
        }
    }

    console.log("seferler aranıyor...");

    //SEFER ARA
    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.click("#searchSeferButton"),
    ]);

    page.on("response", async (response) => {
        const url = response.url();

        if (url.includes("train-availability")) {
            try {
                const json = await response.json();

                const trainLegs = json.trainLegs; // sefer dizisi
                const result = trainLegs[0]; // ilk sefer
                const trainAvailabilities = result.trainAvailabilities;

                let businessCount = 0;
                let economyCount = 0;

                for (const train of trainAvailabilities) {
                    const trains = train.trains;
                    const sefer = trains[0];
                    const number = sefer.number;
                    const availableFareInfo = sefer.availableFareInfo[0];
                    const cabinClasses = availableFareInfo.cabinClasses;
                    for (const c of cabinClasses) {
                        if (c.cabinClass.name === "EKONOMİ") {
                            economyCount += c.availabilityCount;
                        } else if (c.cabinClass.name === "BUSİNESS") {
                            businessCount += c.availabilityCount;
                        }
                    }

                    if (economyCount || businessCount)
                        seferler[number] = {
                            economyCount,
                            businessCount,
                        };
                }

                for (const [number, info] of Object.entries(seferler)) {
                    console.log(
                        `Tren ${number} -> ${info.economyCount} EKONOMİ ; ${info.businessCount} BUSİNESS`
                    );
                }
                console.log();
            } catch (err) {
                //console.log(" JSON çözümlenemedi:", err.message);
            }
        }
    });

    let count = 0;
    while (keepRunning && (repeat === -1 || count < repeat)) {
        console.log(`${count + 1}. tarama yapılıyor... (almak için 'q')`);
        await page.reload({ waitUntil: "networkidle2" });
        await new Promise((res) => setTimeout(res, wait));
        count++;
    }

    let closed = false;
    if (!keepRunning) {
        closed = true;
        await browser.close();

        const newBrowser = await puppeteer.launch({
            headless: false,
            userDataDir: "./my-session",
            defaultViewport: {
                width: 1920,
                height: 1080,
            },
        });

        const newPage = await newBrowser.newPage();
        await newPage.goto(
            "https://ebilet.tcddtasimacilik.gov.tr/sefer-listesi/"
        );
        await newPage.waitForSelector(".card-header", { timeout: 10000 });

        const trainNumbers = Object.keys(seferler);

        await newPage.evaluate((trainNumbers) => {
            const cards = document.querySelectorAll(".card-header");

            cards.forEach((card) => {
                const textContent = card.innerText;
                for (const number of trainNumbers) {
                    if (textContent.includes(number)) {
                        card.setAttribute(
                            "style",
                            `
                    background-color: #aaa !important;
                    color: red !important;
                    border: 5px solid red !important;
                    font-weight: bold !important;
                    animation: flash 1s infinite;
                    `
                        );
                        break;
                    }
                }
            });

            if (!document.querySelector("#custom-anim-style")) {
                const style = document.createElement("style");
                style.id = "custom-anim-style";
                style.innerHTML = `
            @keyframes flash {
                0% { opacity: 1; }
                50% { opacity: 0.6; }
                100% { opacity: 1; }
            }
        `;
                document.head.appendChild(style);
            }
        }, trainNumbers);
        await new Promise((res) => setTimeout(res, 20000));
        await newBrowser.close();
    }

    if (!closed) await browser.close();
    console.log("✅ Tarayıcı kapatıldı.");
    process.exit();
})();
