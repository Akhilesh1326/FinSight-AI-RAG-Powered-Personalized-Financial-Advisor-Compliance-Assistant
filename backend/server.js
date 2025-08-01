const express = require("express");
const app = express();

// Route: GET /api/greet
app.get("/api/greet", (req, res) => {
  res.json({ message: "Hello" });
});

// Start the server on port 8000
app.listen(8000, () => {
  console.log("Server started at http://localhost:8000");
});
