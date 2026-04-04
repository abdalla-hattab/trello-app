import { translate } from '@vitalets/google-translate-api';
import fs from 'fs';

async function test() {
    try {
        const res = await translate('World Laughter Day', { to: 'ar' });
        console.log(res.text);
    } catch (err) {
        console.error(err);
    }
}
test();
