import axios from 'axios';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import extract from 'extract-zip';
import 'dotenv/config';

const downloadPath = path.resolve('./downloads');

async function download() {
    //headless browser getting INSPIRE files

    const url = "https://use-land-property-data.service.gov.uk/datasets/inspire/download"
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const client = await page.target().createCDPSession()
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath,
    })

    await page.goto(url);

    //const inspireDownloadUrls = await page.evaluate(() => {
    const inspireDownloadLinks = await page.evaluate(() => {
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
    })


    const element = await page.waitForSelector("#" + inspireDownloadLinks[0]);


    await element.click();
    await page.waitForTimeout(5000);

    browser.close();

    return;
}

async function unzip() {
    fs.readdir(downloadPath, (err, files) => {
        files.forEach(async file => {
            console.log(file)
            if (file.includes(".zip")) {
                await extract(path.resolve(`./downloads/${file}`), { dir: path.resolve(`./downloads/${file}`.replace(".zip", "")) })
            }
        })
    })
}

//delete all the files already there?
download().then(() => {
    unzip();
});
