import { translate } from '@vitalets/google-translate-api';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

// ============================================================================
// سكربت سحب الأيام العالمية من ويكيبيديا وترجمتها للعربية
// هذا السكربت يسحب الأيام الخاصة بكل شهر ويترجمها عبر Google Translate.
// ============================================================================

const translateText = async (text) => {
    try {
        const res = await translate(text, { to: 'ar' });
        return res.text;
    } catch (err) {
        console.error("Translation error for:", text);
        return text;
    }
};

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchDay(monthName, monthIndex, day) {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${monthName}_${day}&prop=text&format=json`;
    console.log(`Fetching: ${monthName} ${day}...`);
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'NodeScraperBot/1.0 (agencygrow@example.com)'
            }
        });
        if (!response.data || !response.data.parse || !response.data.parse.text) {
            return [];
        }

        const html = response.data.parse.text['*'];
        const $ = cheerio.load(html);
        
        // Find the "Holidays and observances" section header
        const header = $('#Holidays_and_observances').parent();
        if (header.length === 0) return [];
        
        // The list is typically the next <ul> sibling after the header
        const list = header.nextAll('ul').first();
        const items = [];
        
        list.find('li').each((i, el) => {
            // Get text, remove footnotes like [1], clean up
            let text = $(el).text()
                .replace(/\[\d+\]/g, '') // remove [1]
                .replace(/\(.*\)/g, '')   // remove parentheses if needed, but maybe keep them? Let's just remove citations.
                .trim();
            
            // Sometimes it has sub-lists, just take the first line
            text = text.split('\n')[0].trim();
            if (text) {
                items.push(text);
            }
        });

        // Translate the items
        const results = [];
        for (const item of items) {
            // Some basic filtering for very long descriptions (we only want the names)
            if (item.length > 80) continue; 
            
            const translated = await translateText(item);
            results.push({
                m: monthIndex,
                d: day,
                en_name: item,
                name: translated,
                desc: 'مأخوذة من التقويم العالمي', // You can customize this
                category: 'علمي' // Default category, you can tweak logic later
            });
            // Avoid Google Translate rate limits
            await delay(500); 
        }
        
        return results;

    } catch (error) {
        console.error(`Error fetching ${monthName} ${day}:`, error.message);
        return [];
    }
}

async function scrapeMonth(monthName, monthIndex, daysInMonth) {
    let allDays = [];
    for (let d = 1; d <= Math.min(daysInMonth, 31); d++) { // Test up to 3 days for speed, or remove Math.min
        const dayEvents = await fetchDay(monthName, monthIndex, d);
        allDays = allDays.concat(dayEvents);
    }
    return allDays;
}

async function main() {
    // Array to hold the final JSON
    let globalDays = [];
    
    // As an example, we will just scrape May (month index 4, length 31)
    // You can add all months here:
    // const months = [{name: 'January', index: 0, days: 31}, ...];
    
    const targetMonth = { name: 'May', index: 4, days: 31 }; 
    
    console.log(`=== بدء سحب بيانات شهر ${targetMonth.name} ===`);
    const monthData = await scrapeMonth(targetMonth.name, targetMonth.index, targetMonth.days);
    globalDays = globalDays.concat(monthData);
    
    // Save to JSON
    const outputPath = 'global_awareness_days.json';
    await fs.writeFile(outputPath, JSON.stringify(globalDays, null, 2), 'utf8');
    
    console.log(`\n=== اكتمل السحب! ===`);
    console.log(`تم حفظ البيانات في ملف ${outputPath}`);
    console.log(`تم ايجاد ${globalDays.length} مناسبة عالمية لشهر ${targetMonth.name}.`);
}

main();
