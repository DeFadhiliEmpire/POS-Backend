const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const PORT = process.env.PORT || 5000;

dotenv.config();
const app = express();

const { router: saleRouter } = require("./routes/saleRoutes.js");
const { router: syncRoutes } = require("./routes/syncRoutes.js");
const { router: productRouter } = require("./routes/productRoutes.js");
const { router: authRouter } = require("./routes/auth.js");
const { router: categoryRouter } = require("./routes/categoryRoutes.js");
const {
  router: catalogueSyncRoutes,
} = require("./routes/catalogueSyncRoutes.js");

//middleware
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(saleRouter);
app.use(productRouter);
app.use(authRouter);
app.use(syncRoutes);
app.use(categoryRouter);
app.use(catalogueSyncRoutes);

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
