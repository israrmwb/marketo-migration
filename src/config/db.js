require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = `mongodb+srv://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}/`;

const client = new MongoClient(uri);
let dbInstance = null;

async function connectToMongo() {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB (singleton)');
    dbInstance = client.db(process.env.DATABASE_NAME);
    return dbInstance;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

module.exports = { connectToMongo };
