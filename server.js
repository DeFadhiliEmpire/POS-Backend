const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const PORT = process.env.PORT || 5000;

dotenv.config();
const app = express();

const { router: saleRouter } = require("./routes/saleRoutes.js");
const { router: syncRoutes } = require("./routes/syncRoutes.js");
const { router: productRouter } = require("./routes/productRoutes.js");
const { router: authRouter } = require("./routes/auth.js");
const { router: categoryRouter } = require("./routes/categoryRoutes.js");

//middleware
app.use(cors());
app.use(express.json());
app.use(saleRouter);
app.use(productRouter);
app.use(authRouter);
app.use(syncRoutes);
app.use(categoryRouter);

app.get("/", (req, res) => {
  res.send("POS Backend is running!");
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected Sucessfully✅✅"))
  .then(() =>
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`)),
  )
  .catch((err) => console.log(err));
