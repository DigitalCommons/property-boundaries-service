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
const puppeteer_1 = __importDefault(require("puppeteer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const extract_zip_1 = __importDefault(require("extract-zip"));
require("dotenv/config");
const downloadPath = path_1.default.resolve('./downloads');
function download() {
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
//delete all the files already there?
download().then(() => {
    unzip();
});
//# sourceMappingURL=generate.js.map