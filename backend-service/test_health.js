import http from 'http';

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/health',
    method: 'GET'
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
