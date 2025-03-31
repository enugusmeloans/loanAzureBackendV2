// This file defines the main application routes and handles database interactions.

import express from "express";
import sql from 'mssql';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from "node-fetch"; // Import fetch for making HTTP requests

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

// Function to evaluate loan eligibility
async function evaluateLoanEligibility(applicationData) {
    try {
        // Commenting out the main logic for testing purposes
        /*
        // Prepare data for the AI endpoint
        const aIdata = {
            how_long_has_your_business_been_active: applicationData.businessInfo.businessAge,
            what_type_of_business_do_you_run: applicationData.businessInfo.businessType,
            in_which_industry_does_your_business_operate: applicationData.businessInfo.businessIndustry,
            lga_of_business: applicationData.businessInfo.businessLGA,
            town_of_business: applicationData.businessInfo.businessTown,
            do_you_have_a_bank_account_for_your_business: applicationData.financeInfo.bankAccountQuestion,
            do_you_use_any_digital_payment_systems: applicationData.financeInfo.digitalPaymentQuestion,
            how_do_you_manage_your_business_finances: applicationData.financeInfo.businessFinanceQuestion,
            what_are_the_biggest_challenges_your_business_faces: applicationData.challengeInfo.biggestChallengeQuestion,
            what_kind_of_support_would_you_like_from_government: applicationData.challengeInfo.govtSupportQuestion,
            what_would_help_your_business_grow_the_most: applicationData.challengeInfo.businessGrowthQuestion,
            have_you_ever_tried_to_get_a_loan_for_your_business: applicationData.loanInfo.loanBeforeQuestion,
            if_yes_how_did_you_get_the_loan: applicationData.loanInfo.loanHowQuestion,
            if_you_did_not_get_a_loan_what_was_the_main_reason: applicationData.loanInfo.whyNoLoan,
            have_you_faced_any_issues_with_government_rules_or_taxes: applicationData.regulatoryInfo.regulatoryChallengeQuestion,
        };

        // Post data to the AI endpoint
        const aIresponse = await fetch('https://c7cb-197-210-84-126.ngrok-free.app/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(aIdata),
        });

        const aIresponseJson = await aIresponse.json();
        console.log("aIresponseJson", aIresponseJson);

        // Determine loan status based on AI response
        const loanStatus = aIresponseJson === "Eligible for Loan" ? "Accepted1" : "Rejected1";
        console.log("loanStatus", loanStatus);

        return loanStatus;
        */

        // For testing, always return the positive value
        return "Rejected1";
    } catch (error) {
        console.error("Error evaluating loan eligibility:", error);
        throw new Error("Failed to evaluate loan eligibility");
    }
}

//--------------------------------------------------------------------
//routes

router.get("/get-all-users",isAuthenticated, isAdmin, async (req, res) => {
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
    const { userEmail, personalInfo, businessInfo, financeInfo, challengeInfo, loanInfo, regulatoryInfo, dateSubmitted } = req.body;

    try {
        const poolConnection = await sql.connect(config);

        // Check for similar applications
        const similarApplicationResult = await poolConnection.request()
            .input('userEmail', sql.VarChar, userEmail)
            .input('businessName', sql.VarChar, businessInfo.businessName)
            .input('businessIndustry', sql.VarChar, businessInfo.businessIndustry)
            .query(`
                SELECT dateSubmitted 
                FROM dbo.Applications 
                INNER JOIN dbo.BusinessInfo 
                ON dbo.Applications.applicationId = dbo.BusinessInfo.applicationId
                INNER JOIN dbo.Users 
                ON dbo.Applications.userId = dbo.Users.userId
                WHERE dbo.Users.userEmail = @userEmail 
                AND dbo.BusinessInfo.businessName = @businessName 
                AND dbo.BusinessInfo.businessIndustry = @businessIndustry
            `);

        if (similarApplicationResult.recordset.length > 0) {
            const lastApplicationDate = new Date(similarApplicationResult.recordset[0].dateSubmitted);
            const currentApplicationDate = new Date(dateSubmitted);

            // Check if the new application's dateSubmitted is at least three months older
            const threeMonthsLater = new Date(lastApplicationDate);
            threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

            if (currentApplicationDate < threeMonthsLater) {
                return res.status(400).json({ error: "Please try again after three months." });
            }
        }

        // Evaluate loan eligibility
        const loanStatus = await evaluateLoanEligibility(req.body);

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
            .input('CAC', sql.Int, personalInfo.CAC)
            .input('BVN', sql.Int, personalInfo.BVN)
            .input('NIN', sql.Int, personalInfo.NIN)
            .query('INSERT INTO dbo.PersonalInfo (applicationId, fullName, dob, gender, email, phone, residentAddress, LGA, state, CAC, BVN, NIN) VALUES (@applicationId, @fullName, @dob, @gender, @email, @phone, @residentAddress, @LGA, @state, @CAC, @BVN, @NIN)');

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

        // Check the loan status and respond accordingly
        if (loanStatus === "Rejected1") {
            return res.status(200).json({ message: "Application submitted but rejected based on eligibility criteria", status: "Rejected", applicationId });
        }

        res.status(200).json({ message: 'Application submitted successfully', status: "Accepted", applicationId });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint to get details of all applications -tpm
router.get('/get-all-applications', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch the required details of all applications
        const result = await poolConnection.request().query(`
            SELECT 
                Applications.dateSubmitted,
                BusinessInfo.businessName,
                PersonalInfo.fullName AS applicantName,
                Users.userName AS userName,
                Applications.loanStatus
            FROM dbo.Applications
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
        `);

        poolConnection.close();

        // Return the fetched data as a JSON object with an array of applications.
        res.status(200).json({ applications: result.recordset });
    } catch (err) {
        console.error("Error fetching applications:", err.message);
        res.status(500).json({ error: "Failed to fetch applications" });
    }
});

// Endpoint to get every single detail of an application by applicationId
router.get('/get-application-details/:applicationId', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Query to fetch all details of the application, including CAC, BVN, and NIN
        const result = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    Users.userName AS userName,
                    Users.userEmail AS userEmail,
                    PersonalInfo.fullName AS applicantName,
                    PersonalInfo.dob,
                    PersonalInfo.gender,
                    PersonalInfo.email AS applicantEmail,
                    PersonalInfo.phone,
                    PersonalInfo.residentAddress,
                    PersonalInfo.LGA AS personalLGA,
                    PersonalInfo.state AS personalState,
                    PersonalInfo.CAC,
                    PersonalInfo.BVN,
                    PersonalInfo.NIN,
                    BusinessInfo.businessName,
                    BusinessInfo.businessAddress,
                    BusinessInfo.businessAge,
                    BusinessInfo.businessType,
                    BusinessInfo.businessIndustry,
                    BusinessInfo.businessLGA,
                    BusinessInfo.businessTown,
                    FinanceInfo.bankAccountQuestion,
                    FinanceInfo.digitalPaymentQuestion,
                    FinanceInfo.businessFinanceQuestion,
                    ChallengeInfo.biggestChallengeQuestion,
                    ChallengeInfo.govtSupportQuestion,
                    ChallengeInfo.businessGrowthQuestion,
                    LoanInfo.loanBeforeQuestion,
                    LoanInfo.loanHowQuestion,
                    LoanInfo.whyNoLoan,
                    RegulatoryInfo.regulatoryChallengeQuestion
                FROM dbo.Applications
                INNER JOIN dbo.Users ON Applications.userId = Users.userId
                INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
                INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
                INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
                INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
                WHERE Applications.applicationId = @applicationId
            `);

        poolConnection.close();

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Application not found" });
        }

        // Return the fetched application details
        res.status(200).json({ applicationDetails: result.recordset[0] });
    } catch (err) {
        console.error("Error fetching application details:", err.message);
        res.status(500).json({ error: "Failed to fetch application details" });
    }
});

// Endpoint for admin to accept an application
router.post('/accept-application', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { applicationId } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus 
                FROM dbo.Applications 
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];

        // Ensure the application is currently "Pending"
        if (loanStatus !== "Pending") {
            poolConnection.close();
            return res.status(400).json({ error: "Only applications with a 'Pending' status can be accepted" });
        }

        // Update the loanStatus to "Accepted2"
        await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanStatus', sql.VarChar, "Accepted2")
            .query(`
                UPDATE dbo.Applications 
                SET loanStatus = @loanStatus 
                WHERE applicationId = @applicationId
            `);

        poolConnection.close();
        res.status(200).json({ message: "Application accepted successfully", applicationId });
    } catch (err) {
        console.error("Error accepting application:", err.message);
        res.status(500).json({ error: "Failed to accept application" });
    }
});

// Endpoint for admin to reject an application
router.post('/reject-application', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { applicationId } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus 
                FROM dbo.Applications 
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];

        // Ensure the application is currently "Pending"
        if (loanStatus !== "Pending") {
            poolConnection.close();
            return res.status(400).json({ error: "Only applications with a 'Pending' status can be rejected" });
        }

        // Update the loanStatus to "Rejected2"
        await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanStatus', sql.VarChar, "Rejected2")
            .query(`
                UPDATE dbo.Applications 
                SET loanStatus = @loanStatus 
                WHERE applicationId = @applicationId
            `);

        poolConnection.close();
        res.status(200).json({ message: "Application rejected successfully", applicationId });
    } catch (err) {
        console.error("Error rejecting application:", err.message);
        res.status(500).json({ error: "Failed to reject application" });
    }
});

// Endpoint to resubmit an application
router.post('/resubmit-application', isAuthenticated, async (req, res) => {
    try {
        const { applicationId, personalInfo, businessInfo, financeInfo, challengeInfo, loanInfo, regulatoryInfo } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus 
                FROM dbo.Applications 
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];

        // Ensure the application is currently "Resubmit"
        if (loanStatus !== "Resubmit") {
            poolConnection.close();
            return res.status(400).json({ error: "Only applications with a 'Resubmit' status can be resubmitted" });
        }

        const transaction = new sql.Transaction(poolConnection);
        await transaction.begin();

        // Update the Applications table to change the loanStatus to "Accepted1"
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanStatus', sql.VarChar, "Accepted1")
            .query(`
                UPDATE dbo.Applications 
                SET loanStatus = @loanStatus 
                WHERE applicationId = @applicationId
            `);

        // Update the PersonalInfo table
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
            .input('CAC', sql.Int, personalInfo.CAC)
            .input('BVN', sql.Int, personalInfo.BVN)
            .input('NIN', sql.Int, personalInfo.NIN)
            .query(`
                UPDATE dbo.PersonalInfo 
                SET fullName = @fullName, dob = @dob, gender = @gender, email = @email, 
                    phone = @phone, residentAddress = @residentAddress, LGA = @LGA, 
                    state = @state, CAC = @CAC, BVN = @BVN, NIN = @NIN 
                WHERE applicationId = @applicationId
            `);

        // Update the BusinessInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('businessName', sql.VarChar, businessInfo.businessName)
            .input('businessAddress', sql.VarChar, businessInfo.businessAddress)
            .input('businessAge', sql.VarChar, businessInfo.businessAge)
            .input('businessType', sql.VarChar, businessInfo.businessType)
            .input('businessIndustry', sql.VarChar, businessInfo.businessIndustry)
            .input('businessLGA', sql.VarChar, businessInfo.businessLGA)
            .input('businessTown', sql.VarChar, businessInfo.businessTown)
            .query(`
                UPDATE dbo.BusinessInfo 
                SET businessName = @businessName, businessAddress = @businessAddress, 
                    businessAge = @businessAge, businessType = @businessType, 
                    businessIndustry = @businessIndustry, businessLGA = @businessLGA, 
                    businessTown = @businessTown 
                WHERE applicationId = @applicationId
            `);

        // Update the FinanceInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('bankAccountQuestion', sql.VarChar, financeInfo.bankAccountQuestion)
            .input('digitalPaymentQuestion', sql.VarChar, financeInfo.digitalPaymentQuestion)
            .input('businessFinanceQuestion', sql.VarChar, financeInfo.businessFinanceQuestion)
            .query(`
                UPDATE dbo.FinanceInfo 
                SET bankAccountQuestion = @bankAccountQuestion, 
                    digitalPaymentQuestion = @digitalPaymentQuestion, 
                    businessFinanceQuestion = @businessFinanceQuestion 
                WHERE applicationId = @applicationId
            `);

        // Update the ChallengeInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('biggestChallengeQuestion', sql.VarChar, challengeInfo.biggestChallengeQuestion)
            .input('govtSupportQuestion', sql.VarChar, challengeInfo.govtSupportQuestion)
            .input('businessGrowthQuestion', sql.VarChar, challengeInfo.businessGrowthQuestion)
            .query(`
                UPDATE dbo.ChallengeInfo 
                SET biggestChallengeQuestion = @biggestChallengeQuestion, 
                    govtSupportQuestion = @govtSupportQuestion, 
                    businessGrowthQuestion = @businessGrowthQuestion 
                WHERE applicationId = @applicationId
            `);

        // Update the LoanInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanBeforeQuestion', sql.VarChar, loanInfo.loanBeforeQuestion)
            .input('loanHowQuestion', sql.VarChar, loanInfo.loanHowQuestion)
            .input('whyNoLoan', sql.VarChar, loanInfo.whyNoLoan)
            .query(`
                UPDATE dbo.LoanInfo 
                SET loanBeforeQuestion = @loanBeforeQuestion, 
                    loanHowQuestion = @loanHowQuestion, 
                    whyNoLoan = @whyNoLoan 
                WHERE applicationId = @applicationId
            `);

        // Update the RegulatoryInfo table
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('regulatoryChallengeQuestion', sql.VarChar, regulatoryInfo.regulatoryChallengeQuestion)
            .query(`
                UPDATE dbo.RegulatoryInfo 
                SET regulatoryChallengeQuestion = @regulatoryChallengeQuestion 
                WHERE applicationId = @applicationId
            `);

        await transaction.commit();
        poolConnection.close();

        res.status(200).json({ message: "Application resubmitted successfully", applicationId });
    } catch (err) {
        console.error("Error resubmitting application:", err.message);
        res.status(500).json({ error: "Failed to resubmit application" });
    }
});

// Endpoint for admin to request resubmission of an application
router.post('/request-resubmission', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { applicationId } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus 
                FROM dbo.Applications 
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];

        // Ensure the application is not already in "Resubmit" status
        if (loanStatus === "Resubmit") {
            poolConnection.close();
            return res.status(400).json({ error: "Application is already in 'Resubmit' status" });
        }

        // Update the loanStatus to "Resubmit"
        await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .input('loanStatus', sql.VarChar, "Resubmit")
            .query(`
                UPDATE dbo.Applications 
                SET loanStatus = @loanStatus 
                WHERE applicationId = @applicationId
            `);

        poolConnection.close();
        res.status(200).json({ message: "Resubmission requested successfully", applicationId });
    } catch (err) {
        console.error("Error requesting resubmission:", err.message);
        res.status(500).json({ error: "Failed to request resubmission" });
    }
});

export default router;