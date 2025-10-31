import dotenv from 'dotenv';
import path from 'path';

// Localisation du fichier .env à la racine du monorepo
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });
console.log('✅ .env loaded from', envPath);
