"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const extract_zip_1 = __importDefault(require("extract-zip"));
const csv_parser_1 = __importDefault(require("csv-parser"));
require("dotenv/config");
const query_1 = require("./queries/query");
const downloadPath = path_1.default.resolve('./downloads');
function downloadInspire() {
    return __awaiter(this, void 0, void 0, function* () {
        //headless browser getting INSPIRE files
        const url = "https://use-land-property-data.service.gov.uk/datasets/inspire/download";
        const browser = yield puppeteer_1.default.launch({ headless: true });
        const page = yield browser.newPage();
        const client = yield page.target().createCDPSession();
        yield client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });
        yield page.goto(url);
        //const inspireDownloadUrls = await page.evaluate(() => {
        const inspireDownloadLinks = yield page.evaluate(() => {
            const inspireDownloadLinks = [];
            const pageLinks = document.getElementsByTagName("a");
            let linkIdCount = 0;
            for (const link of pageLinks) {
                if (link.innerText === "Download .gml") {
                    link.id = `download-link-${linkIdCount++}`;
                    inspireDownloadLinks.push(link.id);
                }
            }
            return inspireDownloadLinks;
        });
        const element = yield page.waitForSelector("#" + inspireDownloadLinks[0]);
        yield element.click();
        yield page.waitForTimeout(5000);
        browser.close();
        return;
    });
}
function unzip() {
    return __awaiter(this, void 0, void 0, function* () {
        fs_1.default.readdir(downloadPath, (err, files) => {
            files.forEach((file) => __awaiter(this, void 0, void 0, function* () {
                console.log(file);
                if (file.includes(".zip")) {
                    yield (0, extract_zip_1.default)(path_1.default.resolve(`./downloads/${file}`), { dir: path_1.default.resolve(`./downloads/${file}`.replace(".zip", "")) });
                }
            }));
        });
    });
}
function transformGML() {
    return __awaiter(this, void 0, void 0, function* () {
        fs_1.default.readdir(downloadPath, (err, files) => {
            files.forEach((file) => __awaiter(this, void 0, void 0, function* () {
                const filePath = downloadPath + "/" + file;
                if (!fs_1.default.lstatSync(filePath).isFile()) {
                    console.log(file);
                    fs_1.default.readdir(filePath, (err, files) => {
                        if (files.includes('Land_Registry_Cadastral_Parcels.gml'))
                            console.log("found GML file");
                    });
                }
            }));
        });
    });
}
function downloadOwnerships() {
    return __awaiter(this, void 0, void 0, function* () {
        const datasetsUKResponse = yield axios_1.default.get("https://use-land-property-data.service.gov.uk/api/v1/datasets/ccod", {
            headers: {
                Authorization: process.env.GOV_API_KEY
            }
        });
        const datasetsOverseasResponse = yield axios_1.default.get("https://use-land-property-data.service.gov.uk/api/v1/datasets/ocod", {
            headers: {
                Authorization: process.env.GOV_API_KEY
            }
        });
        const filenameUK = datasetsUKResponse.data.result.public_resources[0].file_name;
        const filenameOverseas = datasetsOverseasResponse.data.result.public_resources[0].file_name;
        const ownershipsUKResponse = yield axios_1.default.get(`https://use-land-property-data.service.gov.uk/api/v1/datasets/ccod/${filenameUK}`, {
            headers: {
                Authorization: process.env.GOV_API_KEY
            }
        });
        const ownershipsOverseasResponse = yield axios_1.default.get(`https://use-land-property-data.service.gov.uk/api/v1/datasets/ocod/${filenameOverseas}`, {
            headers: {
                Authorization: process.env.GOV_API_KEY
            }
        });
        const exampleUKResponse = yield axios_1.default.get(ownershipsUKResponse.data.result.download_url);
        const exampleOverseasResponse = yield axios_1.default.get(ownershipsOverseasResponse.data.result.download_url);
        const exampleCSVPathUK = path_1.default.resolve('./downloads/exampleUK.csv');
        const exampleCSVPathOverseas = path_1.default.resolve('./downloads/exampleOverseas.csv');
        fs_1.default.writeFile(exampleCSVPathUK, exampleUKResponse.data, err => {
            if (err) {
                console.error(err);
            }
        });
        fs_1.default.writeFile(exampleCSVPathOverseas, exampleOverseasResponse.data, err => {
            if (err) {
                console.error(err);
            }
        });
        fs_1.default.createReadStream(exampleCSVPathUK)
            .pipe((0, csv_parser_1.default)())
            .on('data', (ownership) => {
            ownership.proprietor_uk_based = true;
            (0, query_1.createLandOwnership)(ownership);
            //determine update type
            //either add or delete or update in database
        });
        fs_1.default.createReadStream(exampleCSVPathOverseas)
            .pipe((0, csv_parser_1.default)())
            .on('data', (ownership) => {
            ownership.proprietor_uk_based = false;
            (0, query_1.createLandOwnership)(ownership);
            //determine update type
            //either add or delete or update in database
        });
    });
}
//delete all the files already there?
//fs.rmSync(path.resolve(`./downloads`), { recursive: true, force: true });
//downloadInspire().then(unzip).then(transformGML);
transformGML();
//downloadOwnerships();
//# sourceMappingURL=generate.js.map