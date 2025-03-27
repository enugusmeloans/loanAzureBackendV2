// This file defines the main application routes and handles database interactions.

import express from "express";
import sql from 'mssql';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const router = express.Router();

const config = process.env.DATABASE_URI;

//--------------------------------------------------------------
//middlewares

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    console.log('Session:', req.session);
    console.log('User:', req.user);
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).send('Unauthorized');
}

// Middleware to check if user is an admin
async function isAdmin(req, res, next) {
    if (!req.user || !req.user.adminId) {
        return res.status(403).send('Forbidden');
    }

    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('adminId', sql.VarChar, req.user.adminId)
            .query('SELECT * FROM dbo.Admins WHERE adminId = @adminId');

        const admin = result.recordset[0];
        poolConnection.close();

        if (admin && admin.userId === req.user.userId) {
            return next();
        } else {
            return res.status(403).send('Forbidden');
        }
    } catch (err) {
        console.error(err.message);
        return res.status(500).send('Internal Server Error');
    }
}

//--------------------------------------------------------------------
//routes

router.get("/",isAuthenticated, isAdmin, async (req, res) => {
    try {
        let records = [];
        var poolConnection = await sql.connect(config);

        console.log("Reading rows from the Table...");
        var resultSet = await poolConnection.request().query(`SELECT * FROM dbo.Users`);

        console.log("Printing results...");
        resultSet.recordset.forEach((record) => {
            records.push(record);
            console.log(records);
        });

        // close connection only when we're certain application is finished
        poolConnection.close();

        res.json(records);
    } catch (err) {
        console.error(err.message);
        res.status(500).send(err.message);
    }
});

// Endpoint to promote a user to admin
router.post('/promote', isAuthenticated, isAdmin, async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).send('User not found');
        }

        const adminId = crypto.randomBytes(3).toString('hex');

        await poolConnection.request()
            .input('userId', sql.Int, user.userId)
            .input('adminId', sql.VarChar, adminId)
            .query('UPDATE dbo.Users SET adminId = @adminId WHERE userId = @userId');

        await poolConnection.request()
            .input('adminId', sql.VarChar, adminId)
            .input('userId', sql.Int, user.userId)
            .input('fullName', sql.VarChar, user.userName)
            .input('email', sql.VarChar, user.userEmail)
            .query('INSERT INTO dbo.Admins (adminId, userId, fullName, email) VALUES (@adminId, @userId, @fullName, @email)');

        poolConnection.close();
        res.status(200).send('User promoted to admin');
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Internal Server Error');
    }
});

// Endpoint to demote an admin to user
router.post('/demote', isAuthenticated, isAdmin, async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).send('User not found');
        }

        await poolConnection.request()
            .input('adminId', sql.VarChar, user.adminId)
            .query('DELETE FROM dbo.Admins WHERE adminId = @adminId');

        await poolConnection.request()
            .input('userId', sql.Int, user.userId)
            .query('UPDATE dbo.Users SET adminId = NULL WHERE userId = @userId');

        poolConnection.close();
        res.status(200).send('Admin demoted to user');
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Internal Server Error');
    }
});

// Endpoint to check if a user is an admin - untested yet
router.post('/is-admin', isAuthenticated, async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).send('User not found');
        }

        const isAdmin = user.adminId !== null;
        poolConnection.close();
        res.status(200).json({ isAdmin });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Internal Server Error');
    }
});

// Endpoint to submit an application - untested yet
router.post('/submit-application', isAuthenticated, async (req, res) => {
    const { userEmail, personalInfo, businessInfo, financeInfo, challengeInfo, loanInfo, regulatoryInfo, dateSubmitted, loanStatus } = req.body;
    console.log("Submit Application Request Body: ",req.body, personalInfo.fullName);

    try {
        const poolConnection = await sql.connect(config);
        const transaction = new sql.Transaction(poolConnection);

        await transaction.begin();

        // Get userId from userEmail
        const userResult = await transaction.request()
            .input('email', sql.VarChar, userEmail)
            .query('SELECT userId FROM dbo.Users WHERE userEmail = @email');

        const userId = userResult.recordset[0].userId;

        // Insert into Applications table and get the generated applicationId
        const applicationResult = await transaction.request()
            .input('userId', sql.Int, userId)
            .input('dateSubmitted', sql.DateTime, new Date(dateSubmitted))
            .input('loanStatus', sql.VarChar, loanStatus)
            .query('INSERT INTO dbo.Applications (userId, dateSubmitted, loanStatus) OUTPUT INSERTED.applicationId VALUES (@userId, @dateSubmitted, @loanStatus)');

        const applicationId = applicationResult.recordset[0].applicationId;

        // Insert into PersonalInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('fullName', sql.VarChar, personalInfo.fullName)
            .input('dob', sql.Date, personalInfo.dob)
            .input('gender', sql.VarChar, personalInfo.gender)
            .input('email', sql.VarChar, personalInfo.email)
            .input('phone', sql.Int, personalInfo.phone)
            .input('residentAddress', sql.VarChar, personalInfo.residentAddress)
            .input('LGA', sql.VarChar, personalInfo.LGA)
            .input('state', sql.VarChar, personalInfo.state)
            .query('INSERT INTO dbo.PersonalInfo (applicationId, fullName, dob, gender, email, phone, residentAddress, LGA, state) VALUES (@applicationId, @fullName, @dob, @gender, @email, @phone, @residentAddress, @LGA, @state)');

        // Insert into BusinessInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('businessName', sql.VarChar, businessInfo.businessName)
            .input('businessAddress', sql.VarChar, businessInfo.businessAddress)
            .input('businessAge', sql.VarChar, businessInfo.businessAge)
            .input('businessType', sql.VarChar, businessInfo.businessType)
            .input('businessIndustry', sql.VarChar, businessInfo.businessIndustry)
            .input('businessLGA', sql.VarChar, businessInfo.businessLGA)
            .input('businessTown', sql.VarChar, businessInfo.businessTown)
            .query('INSERT INTO dbo.BusinessInfo (applicationId, businessName, businessAddress, businessAge, businessType, businessIndustry, businessLGA, businessTown) VALUES (@applicationId, @businessName, @businessAddress, @businessAge, @businessType, @businessIndustry, @businessLGA, @businessTown)');

        // Insert into FinanceInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('bankAccountQuestion', sql.VarChar, financeInfo.bankAccountQuestion)
            .input('digitalPaymentQuestion', sql.VarChar, financeInfo.digitalPaymentQuestion)
            .input('businessFinanceQuestion', sql.VarChar, financeInfo.businessFinanceQuestion)
            .query('INSERT INTO dbo.FinanceInfo (applicationId, bankAccountQuestion, digitalPaymentQuestion, businessFinanceQuestion) VALUES (@applicationId, @bankAccountQuestion, @digitalPaymentQuestion, @businessFinanceQuestion)');

        // Insert into ChallengeInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('biggestChallengeQuestion', sql.VarChar, challengeInfo.biggestChallengeQuestion)
            .input('govtSupportQuestion', sql.VarChar, challengeInfo.govtSupportQuestion)
            .input('businessGrowthQuestion', sql.VarChar, challengeInfo.businessGrowthQuestion)
            .query('INSERT INTO dbo.ChallengeInfo (applicationId, biggestChallengeQuestion, govtSupportQuestion, businessGrowthQuestion) VALUES (@applicationId, @biggestChallengeQuestion, @govtSupportQuestion, @businessGrowthQuestion)');

        // Insert into LoanInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanBeforeQuestion', sql.VarChar, loanInfo.loanBeforeQuestion)
            .input('loanHowQuestion', sql.VarChar, loanInfo.loanHowQuestion)
            .input('whyNoLoan', sql.VarChar, loanInfo.whyNoLoan)
            .query('INSERT INTO dbo.LoanInfo (applicationId, loanBeforeQuestion, loanHowQuestion, whyNoLoan) VALUES (@applicationId, @loanBeforeQuestion, @loanHowQuestion, @whyNoLoan)');

        // Insert into RegulatoryInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('regulatoryChallengeQuestion', sql.VarChar, regulatoryInfo.regulatoryChallengeQuestion)
            .query('INSERT INTO dbo.RegulatoryInfo (applicationId, regulatoryChallengeQuestion) VALUES (@applicationId, @regulatoryChallengeQuestion)');

        await transaction.commit();
        poolConnection.close();
        res.status(200).send('Application submitted successfully');
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Internal Server Error');
    }
});

export default router;