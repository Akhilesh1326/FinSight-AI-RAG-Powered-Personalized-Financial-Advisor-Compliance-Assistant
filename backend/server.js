const express = require("express");
const app = express();

app.get("/api/greet", (req, res) => {
  res.json({ message: "Hello" });
});



app.listen(8000, () => {
  console.log("Server started at http://localhost:8000");
});
