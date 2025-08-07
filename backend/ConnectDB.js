
const { Client } = require("pg");
const mongoose = require('mongoose');

const { Pool } = require('pg');

let pool;

const connectToPostgresSQL = () => {
    if (!pool) {
        pool = new Pool({
            user: 'postgres',
            host: 'localhost',
            database: process.env.PG_DB_NAME,
            password: process.env.PG_PASSWORD,
            port: process.env.PG_PORT,
            max: 10, // optional: maximum number of clients in the pool
            idleTimeoutMillis: 30000, // optional: close idle clients after 30 seconds
        });

        pool.on('connect', () => {
            console.log('Connected to PostgreSQL via pool');
        });

        pool.on('error', (err) => {
            console.error('Unexpected error on idle PostgreSQL client', err);
            process.exit(-1);
        });
    }

    return pool;
};



// MongoDb connection

const connectToMongo = () =>{
    mongoose.connect("mongodb://localhost:27017/bot-partner" , {
        useNewUrlParser : true ,
        useUnifiedTopology : true ,
    })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection Error" , err) );
}


module.exports = { connectToPostgresSQL, connectToMongo };
