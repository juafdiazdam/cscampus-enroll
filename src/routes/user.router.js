import express from "express";
import {newRecord, fileTest, queryUserdb} from "../services/user.service.js";
import formidable from "formidable";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(express.json());
router.get('/form', (req, res) => {res.render("form")});
router.get('/formTest', (req, res) => {res.render("formTest")});
router.get('/success', (req, res) => {res.render("success")});
router.get('/not-success', (req, res) => {res.render("not-success")});
router.post('/', newRecord);
router.get('/list', queryUserdb);
router.post('/upload', fileTest);

export default router;