// This file defines the main application routes and handles database interactions.

import express from "express";
import sql from 'mssql';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from "node-fetch"; // Import fetch for making HTTP requests
import { sendEmail } from './emailService.js'; // Import the email service
import jwt from 'jsonwebtoken';

dotenv.config();

const router = express.Router();

const config = process.env.DATABASE_URI;

//--------------------------------------------------------------
//middlewares

// Middleware to check if user is authenticated using JWT
function isAuthenticated(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// Updated isAdmin middleware to check if the user is an admin using the JWT token
async function isAdmin(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1]; // Extract the JWT token from the Authorization header
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized', data: {} }); // Return unauthorized if no token is provided
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to check if the user is an admin
        const result = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query('SELECT adminId FROM dbo.Users WHERE userId = @userId');

        poolConnection.close(); // Close the database connection

        if (result.recordset.length === 0 || !result.recordset[0].adminId) {
            return res.status(403).json({ success: false, message: 'Forbidden: User is not an admin', data: {} }); // Return forbidden if the user is not an admin
        }

        next(); // Proceed to the next middleware or route handler
    } catch (err) {
        console.error('Error checking admin status:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
}

// Function to evaluate loan eligibility
// async function evaluateLoanEligibility(applicationData) {
//     try {
//     //     // Commenting out the main logic for testing purposes

//     //     // Prepare data for the AI endpoint
//     //     const aIdata = {
//     //         how_long_has_your_business_been_active: applicationData.businessInfo.businessAge,
//     //         what_type_of_business_do_you_run: applicationData.businessInfo.businessType,
//     //         in_which_industry_does_your_business_operate: applicationData.businessInfo.businessIndustry,
//     //         lga_of_business: applicationData.businessInfo.businessLGA,
//     //         town_of_business: applicationData.businessInfo.businessTown,
//     //         do_you_have_a_bank_account_for_your_business: applicationData.financeInfo.bankAccountQuestion,
//     //         do_you_use_any_digital_payment_systems: applicationData.financeInfo.digitalPaymentQuestion,
//     //         how_do_you_manage_your_business_finances: applicationData.financeInfo.businessFinanceQuestion,
//     //         what_are_the_biggest_challenges_your_business_faces: applicationData.challengeInfo.biggestChallengeQuestion,
//     //         what_kind_of_support_would_you_like_from_government: applicationData.challengeInfo.govtSupportQuestion,
//     //         what_would_help_your_business_grow_the_most: applicationData.challengeInfo.businessGrowthQuestion,
//     //         have_you_ever_tried_to_get_a_loan_for_your_business: applicationData.loanInfo.loanBeforeQuestion,
//     //         if_yes_how_did_you_get_the_loan: applicationData.loanInfo.loanHowQuestion,
//     //         if_you_did_not_get_a_loan_what_was_the_main_reason: applicationData.loanInfo.whyNoLoan,
//     //         have_you_faced_any_issues_with_government_rules_or_taxes: applicationData.regulatoryInfo.regulatoryChallengeQuestion,
//     //     };

//     //     // Post data to the AI endpoint
//     //     const aIresponse = await fetch('https://loan-eligibility-api-d0fec7cqg4h2c0bb.canadacentral-01.azurewebsites.net', {
//     //         method: 'POST',
//     //         headers: {
//     //             'Content-Type': 'application/json',
//     //         },
//     //         body: JSON.stringify(aIdata),
//     //     });

//     //     const aIresponseJson = await aIresponse.json();
//     //     console.log("aIresponseJson", aIresponseJson);

//     //     // Determine loan status based on AI response
//     //     const loanStatus = aIresponseJson === "Eligible for Loan" ? "Accepted1" : "Rejected1";
//     //     console.log("loanStatus", loanStatus);

//     //     return loanStatus;
        

//         // For testing, always return the positive value
//         return "Accepted1";
//     } catch (error) {
//         console.error("Error evaluating loan eligibility:", error);
//         throw new Error("Failed to evaluate loan eligibility");
//     }
// }


const evaluateLoanEligibility = async (applicationData) => {
    const apiUrl = "https://loan-eligibility-api-d0fec7cqg4h2c0bb.canadacentral-01.azurewebsites.net/predict";

    const formData = {
        "how_long_has_your_business_been_active": applicationData.businessInfo.businessAge,
        "what_type_of_business_do_you_run": applicationData.businessInfo.businessType,
        "in_which_industry_does_your_business_operate": applicationData.businessInfo.businessIndustry,
        "lga_of_business": applicationData.businessInfo.businessLGA,
        "town_of_business": applicationData.businessInfo.businessTown,
        "do_you_have_a_bank_account_for_your_business": applicationData.financeInfo.bankAccountQuestion,
        "do_you_use_any_digital_payment_systems": applicationData.financeInfo.digitalPaymentQuestion,
        "how_do_you_manage_your_business_finances": applicationData.financeInfo.businessFinanceQuestion,
        "what_are_the_biggest_challenges_your_business_faces": applicationData.challengeInfo.biggestChallengeQuestion,
        "what_kind_of_support_would_you_like_from_government": applicationData.challengeInfo.govtSupportQuestion,
        "what_would_help_your_business_grow_the_most": applicationData.challengeInfo.businessGrowthQuestion,
        "have_you_ever_tried_to_get_a_loan_for_your_business": applicationData.loanInfo.loanBeforeQuestion,
        "if_yes_how_did_you_get_the_loan": applicationData.loanInfo.loanHowQuestion,
        "if_you_did_not_get_a_loan_what_was_the_main_reason": applicationData.loanInfo.whyNoLoan,
        "have_you_faced_any_issues_with_government_rules_or_taxes": applicationData.regulatoryInfo.regulatoryChallengeQuestion,
    };

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(formData),
        });

        if (response.ok) {
            const result = await response.json();
            console.log(result["Loan Eligibility"]);  // Display the result to the user
            const loanStatus = result["Loan Eligibility"] === "Eligible for Loan" ? "Accepted1" : "Rejected1";
            // console.log(loanStatus)

            return loanStatus;
        } else {
            console.error("Error:", response.statusText, response);
        }
    } catch (error) {
        console.error("Request failed:", error);
        return "Error occurred while checking loan eligibility";
    }
};


//--------------------------------------------------------------------
//routes

// Endpoint to get all users 
router.get("/get-all-users", async (req, res) => {
    try {
        let records = [];
        var poolConnection = await sql.connect(config);

        console.log("Reading rows from the Table...");
        var resultSet = await poolConnection.request().query(`SELECT userId, userName, userEmail, adminId FROM dbo.Users`);

        console.log("Printing results...");
        resultSet.recordset.forEach((record) => {
            records.push(record);
        });

        // close connection only when we're certain application is finished
        poolConnection.close();

        res.status(200).json({ success: true, message: 'Users fetched successfully', data: { users: records } });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: 'Error fetching users', data: { error: err.message } });
    }
});

// Endpoint to promote a user to admin
router.post('/promote', async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).json({ success: false, message: 'User not found' });
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
        res.status(200).json({ success: true, message: 'User promoted to admin', data: { adminId } });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: 'Error promoting user', data: { error: err.message } });
    }
});

// Endpoint to demote an admin to user
router.post('/demote', async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await sql.connect(config);
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).json({ error: 'User not found' });
        }

        await poolConnection.request()
            .input('adminId', sql.VarChar, user.adminId)
            .query('DELETE FROM dbo.Admins WHERE adminId = @adminId');

        await poolConnection.request()
            .input('userId', sql.Int, user.userId)
            .query('UPDATE dbo.Users SET adminId = NULL WHERE userId = @userId');

        poolConnection.close();
        res.status(200).json({ message: 'Admin demoted to user' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Updated /is-admin endpoint to check if the user is an admin using the JWT token
router.get('/is-admin', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1]; // Extract the JWT token from the Authorization header
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized', data: {} }); // Return unauthorized if no token is provided
    }

    try {
        console.log("We are checking admin status!");
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to check if the user is an admin
        const result = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query('SELECT adminId FROM dbo.Users WHERE userId = @userId');

        poolConnection.close(); // Close the database connection

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found', data: {} }); // Return not found if the user does not exist
        }

        const isAdmin = result.recordset[0].adminId !== null; // Check if the adminId is not null

        res.status(200).json({ success: true, message: 'Admin status retrieved successfully', data: { isAdmin } }); // Return the admin status
    } catch (err) {
        console.error('Error checking admin status:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Updated /submit-application route to check for user details in ExtraUserDetails table
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
                return res.status(400).json({ success: false, message: "You have a similar application submitted within the last three months." });
            }
        }

        // Evaluate loan eligibility
        const loanStatus = await evaluateLoanEligibility(req.body);

        const transaction = new sql.Transaction(poolConnection);
        await transaction.begin();

        
        // Get userId from userEmail
        const userResult = await poolConnection.request()
        .input('email', sql.VarChar, userEmail)
        .query('SELECT userId FROM dbo.Users WHERE userEmail = @email');
    
            if (userResult.recordset.length === 0) {
                poolConnection.close();
                return res.status(404).json({ success: false, message: 'User not found', data: {} });
            }
    
            const userId = userResult.recordset[0].userId;
    
        // Fetch user details from ExtraUserDetails table
        const extraDetailsResult = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT firstName, lastName, otherName, dob, gender, LGA, contactEmail AS email, phoneNumber AS phone
                FROM dbo.ExtraUserDetails
                WHERE userId = @userId
            `);

        if (extraDetailsResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(400).json({ success: false, message: 'Please complete your profile first', data: {} });
        }

        const personalExtraInfo = extraDetailsResult.recordset[0];

        // Insert into Applications table and get the generated applicationId
        const applicationResult = await transaction.request()
            .input('userId', sql.Int, userId)
            .input('dateSubmitted', sql.DateTime, new Date(dateSubmitted))
            .input('loanStatus', sql.VarChar, loanStatus)
            .query('INSERT INTO dbo.Applications (userId, dateSubmitted, loanStatus) OUTPUT INSERTED.applicationId VALUES (@userId, @dateSubmitted, @loanStatus)');

        const applicationId = applicationResult.recordset[0].applicationId;

        // Insert into PersonalInfo table using details from ExtraUserDetails
        await transaction.request()
            .input('applicationId', sql.Int, applicationId)
            .input('fullName', sql.VarChar, `${personalExtraInfo.firstName} ${personalExtraInfo.lastName} ${personalExtraInfo.otherName}`)
            .input('dob', sql.Date, personalExtraInfo.dob)
            .input('gender', sql.VarChar, personalExtraInfo.gender)
            .input('email', sql.VarChar, personalExtraInfo.email)
            .input('phone', sql.BigInt, personalExtraInfo.phone)
            .input('residentAddress', sql.VarChar, personalInfo.residentAddress)
            .input('LGA', sql.VarChar, personalExtraInfo.LGA)
            .input('state', sql.VarChar, personalInfo.state)
            .input('BVN', sql.BigInt, personalInfo.BVN)
            .input('NIN', sql.BigInt, personalInfo.NIN)
            .query('INSERT INTO dbo.PersonalInfo (applicationId, fullName, dob, gender, email, phone, residentAddress, LGA, state, BVN, NIN) VALUES (@applicationId, @fullName, @dob, @gender, @email, @phone, @residentAddress, @LGA, @state, @BVN, @NIN)');

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

        // Fetch the details of the submitted application
        const applicationSubmittedResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    BusinessInfo.businessName,
                    BusinessInfo.businessIndustry,
                    PersonalInfo.fullName AS applicantName
                FROM dbo.Applications
                INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                WHERE Applications.applicationId = @applicationId
            `);

        const applicationSResult = applicationSubmittedResult.recordset[0];

        poolConnection.close();

        // Check the loan status and respond accordingly
        if (loanStatus === "Rejected1") {
            return res.status(200).json({ success: true, message: "Application submitted but rejected based on eligibility criteria", data:{ status: "Rejected", ...applicationSResult} });
        }

        res.status(200).json({ success: true, message: 'Application submitted successfully', data:{status: "Accepted", ...applicationSResult} });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: 'Error submitting application', data: { error: err.message } });
    }
});

// Modified /get-all-applications endpoint to handle pagination
router.post('/get-all-applications', isAdmin, async (req, res) => {
    const { From, To } = req.body; // Extract From and To values from the request body

    if (!From || !To || From < 1 || To < 1) {
        return res.status(400).json({ success: false, message: 'Invalid From or To values', data: {} }); // Validate input values
    }

    try {
        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to get the total number of applications
        const totalResult = await poolConnection.request().query('SELECT COUNT(*) AS totalApplications FROM dbo.Applications');
        const totalApplications = totalResult.recordset[0].totalApplications;

        if (From > totalApplications) {
            return res.status(400).json({ success: false, message: 'From value exceeds total number of applications', data: {} }); // Validate From value
        }

        const adjustedTo = Math.min(To, totalApplications); // Adjust To value if it exceeds total applications

        // Query to fetch applications within the specified range
        const result = await poolConnection.request()
            .input('offset', sql.Int, From - 1) // Offset for SQL query (0-based index)
            .input('limit', sql.Int, adjustedTo - From + 1) // Limit for SQL query
            .query(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    BusinessInfo.businessName,
                    PersonalInfo.fullName AS applicantName,
                    Applications.loanStatus
                FROM dbo.Applications
                INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                ORDER BY Applications.applicationId
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);

        poolConnection.close(); // Close the database connection

        res.status(200).json({
            success: true,
            message: 'Applications retrieved successfully',
            data: { applications: result.recordset }
        }); // Return the applications
    } catch (err) {
        console.error('Error fetching applications:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Endpoint to get details of all applications - dont postman yet till after deploy testing
router.get('/get-every-applications',isAdmin, async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch the required details of all applications
        const result = await poolConnection.request().query(`
            SELECT 
                Applications.applicationId,
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
        res.status(200).json({ success: true, message:"Applications Fetched Successfully", data: { applications: result.recordset } });
    } catch (err) {
        console.error("Error fetching applications:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch applications" });
    }
});

// Endpoint to get every single detail of an application by applicationId
router.get('/get-application-details/:applicationId',isAuthenticated, async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ success: false, message: "Application ID is required" });
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
            return res.status(404).json({ succes: false, message: "Application not found" });
        }

        // Return the fetched application details
        res.status(200).json({ success: true, applicationDetails: result.recordset[0] });
    } catch (err) {
        console.error("Error fetching application details:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch application details" });
    }
});

// Endpoint for admin to accept an application - postman later
router.post('/accept-application', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus, userEmail 
                FROM dbo.Applications 
                INNER JOIN dbo.Users ON dbo.Applications.userId = dbo.Users.userId
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult.recordset[0];

        // Ensure the application is currently "Pending"
        if (loanStatus !== "Pending") {
            poolConnection.close();
            return res.status(400).json({ success: false, message: "Only applications with a 'Pending' status can be accepted" });
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

        // Send email to the user
        await sendEmail(userEmail, "Application Accepted", emailBody);

        res.status(200).json({ success: true, message: "Application accepted successfully and email sent", data: { applicationId } });
    } catch (err) {
        console.error("Error accepting application:", err.message);
        res.status(500).json({ success: false, message: "Failed to accept application" });
    }
});

// Endpoint for admin to reject an application
router.post('/reject-application', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus, userEmail 
                FROM dbo.Applications 
                INNER JOIN dbo.Users ON dbo.Applications.userId = dbo.Users.userId
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult.recordset[0];

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

        // Send email to the user
        await sendEmail(userEmail, "Application Rejected", emailBody);

        res.status(200).json({ message: "Application rejected successfully and email sent", applicationId });
    } catch (err) {
        console.error("Error rejecting application:", err.message);
        res.status(500).json({ error: "Failed to reject application" });
    }
});

// Endpoint to resubmit an application
router.post('/resubmit-application', async (req, res) => {
    try {
        const { userEmail,applicationId, personalInfo, businessInfo, financeInfo, challengeInfo, loanInfo, regulatoryInfo } = req.body;
//-----------------------------------------
        // Get userId from userEmail
        const poolConnection1 = await sql.connect(config);
        const userResult = await poolConnection.request()
            .input('email', sql.VarChar, userEmail)
            .query('SELECT userId FROM dbo.Users WHERE userEmail = @email');

            if (userResult.recordset.length === 0) {
                poolConnection1.close(); 
                return res.status(404).json({ success: false, message: 'User not found', data: {} });
            }

            const userId = userResult.recordset[0].userId;

                // Fetch user details from ExtraUserDetails table
                const extraDetailsResult = await poolConnection.request()
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT firstName, lastName, otherName, dob, gender, LGA, contactEmail AS email, phoneNumber AS phone
                    FROM dbo.ExtraUserDetails
                    WHERE userId = @userId
                `);
    
            if (extraDetailsResult.recordset.length === 0) {
                poolConnection.close();
                return res.status(400).json({ success: false, message: 'Please complete your profile first', data: {} });
            }
    
            const personalExtraInfo = extraDetailsResult.recordset[0];
//--------------------------------------------
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
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];

        // Ensure the application is currently "Resubmit"
        if (loanStatus !== "Resubmit") {
            poolConnection.close();
            return res.status(400).json({ success: false, message: "Only applications with a 'Resubmit' status can be resubmitted" });
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
            .input('fullName', sql.VarChar, `${personalExtraInfo.firstName} ${personalExtraInfo.lastName} ${personalExtraInfo.otherName}`)
            .input('dob', sql.Date, personalExtraInfo.dob)
            .input('gender', sql.VarChar, personalExtraInfo.gender)
            .input('email', sql.VarChar, personalExtraInfo.email)
            .input('phone', sql.BigInt, personalExtraInfo.phone)
            .input('residentAddress', sql.VarChar, personalInfo.residentAddress)
            .input('LGA', sql.VarChar, personalExtraInfo.LGA)
            .input('state', sql.VarChar, personalInfo.state)
            .input('BVN', sql.BigInt, personalInfo.BVN)
            .input('NIN', sql.BigInt, personalInfo.NIN)
            .query(`
                UPDATE dbo.PersonalInfo 
                SET fullName = @fullName, dob = @dob, gender = @gender, email = @email, 
                    phone = @phone, residentAddress = @residentAddress, LGA = @LGA, 
                    state = @state, BVN = @BVN, NIN = @NIN 
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

        // Fetch the details of the resubmitted application
        const applicationSubmittedResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    BusinessInfo.businessName,
                    BusinessInfo.businessIndustry,
                    PersonalInfo.fullName AS applicantName
                FROM dbo.Applications
                INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                WHERE Applications.applicationId = @applicationId
            `);

        const applicationSResult = applicationSubmittedResult.recordset[0];

        poolConnection.close();

        res.status(200).json({
            success: true,
            message: 'Application resubmitted successfully',
            data: { application: applicationSResult }
        });
    } catch (err) {
        console.error('Error resubmitting application:', err.message);
        res.status(500).json({ success: false, message: 'Failed to resubmit application', data: { error: err.message } });
    }
});

// Endpoint for admin to request resubmission of an application
router.post('/request-resubmission', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;

        // Validate applicationId
        if (!applicationId) {
            return res.status(400).json({ success: false, error: "Application ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Check the current loanStatus of the application
        const applicationResult = await poolConnection.request()
            .input('applicationId', sql.Int, applicationId)
            .query(`
                SELECT loanStatus, userEmail 
                FROM dbo.Applications 
                INNER JOIN dbo.Users ON dbo.Applications.userId = dbo.Users.userId
                WHERE applicationId = @applicationId
            `);

        if (applicationResult.recordset.length === 0) {
            poolConnection.close();
            return res.status(404).json({ success: false, error: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult.recordset[0];

        // Ensure the application is not already in "Resubmit" status
        if (loanStatus === "Resubmit") {
            poolConnection.close();
            return res.status(400).json({ success: false, error: "Application is already in 'Resubmit' status" });
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

        // Send email to the user
        await sendEmail(userEmail, "Resubmission Requested", emailBody);

        res.status(200).json({ success: true, message: "Resubmission requested successfully and email sent", data: {applicationId} });
    } catch (err) {
        console.error("Error requesting resubmission:", err.message);
        res.status(500).json({ success: false, error: "Failed to request resubmission" });
    }
});

// Endpoint to insert or update a user's record in ExtraUserDetails - note to self - to test later
router.post('/extra-user-details', async (req, res) => {
    try {
        const { userId, firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin, dob } = req.body;

        // Check if all required fields are provided
        if (!userId || !firstName || !lastName || !otherName || !gender || !phoneNumber || !contactEmail || !address || !LGA || !stateOfOrigin || !dob) {
            return res.status(400).json({ success: false, error: "All fields are required" });
        }

        const poolConnection = await sql.connect(config);

        // Check if the record exists in ExtraUserDetails
        const existingRecordResult = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM dbo.ExtraUserDetails WHERE userId = @userId');

        const existingRecord = existingRecordResult.recordset[0];

        if (existingRecord) {
            // Update the record in ExtraUserDetails
            await poolConnection.request()
                .input('userId', sql.Int, userId)
                .input('firstName', sql.VarChar, firstName)
                .input('lastName', sql.VarChar, lastName)
                .input('otherName', sql.VarChar, otherName)
                .input('gender', sql.VarChar, gender)
                .input('phoneNumber', sql.BigInt, phoneNumber)
                .input('contactEmail', sql.VarChar, contactEmail)
                .input('address', sql.VarChar, address)
                .input('LGA', sql.VarChar, LGA)
                .input('stateOfOrigin', sql.VarChar, stateOfOrigin)
                .input('dob', sql.Date, dob)
                .query(`
                    UPDATE dbo.ExtraUserDetails
                    SET firstName = @firstName, lastName = @lastName, otherName = @otherName,
                        gender = @gender, phoneNumber = @phoneNumber, contactEmail = @contactEmail,
                        address = @address, LGA = @LGA, stateOfOrigin = @stateOfOrigin, dob = @dob
                    WHERE userId = @userId
                `);

            // Update userName in Users table
            const updatedUserName = `${firstName} ${lastName}`;
            await poolConnection.request()
                .input('userId', sql.Int, userId)
                .input('userName', sql.VarChar, updatedUserName)
                .query('UPDATE dbo.Users SET userName = @userName WHERE userId = @userId');
        } else {
            // Insert a new record into ExtraUserDetails
            await poolConnection.request()
                .input('userId', sql.Int, userId)
                .input('firstName', sql.VarChar, firstName)
                .input('lastName', sql.VarChar, lastName)
                .input('otherName', sql.VarChar, otherName)
                .input('gender', sql.VarChar, gender)
                .input('phoneNumber', sql.BigInt, phoneNumber)
                .input('contactEmail', sql.VarChar, contactEmail)
                .input('address', sql.VarChar, address)
                .input('LGA', sql.VarChar, LGA)
                .input('stateOfOrigin', sql.VarChar, stateOfOrigin)
                .query(`
                    INSERT INTO dbo.ExtraUserDetails (userId, firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin)
                    VALUES (@userId, @firstName, @lastName, @otherName, @gender, @phoneNumber, @contactEmail, @address, @LGA, @stateOfOrigin)
                `);

            // Update userName in Users table
            const updatedUserName = `${firstName} ${lastName}`;
            await poolConnection.request()
                .input('userId', sql.Int, userId)
                .input('userName', sql.VarChar, updatedUserName)
                .query('UPDATE dbo.Users SET userName = @userName WHERE userId = @userId');
        }

        poolConnection.close();
        res.status(200).json({ success: true, message: "User details updated successfully" });
    } catch (err) {
        console.error("Error updating user details:", err.message);
        res.status(500).json({ success: false, error: "Failed to update user details" });
    }
});

// Endpoint to get all details of a user from ExtraUserDetails and Users tables- to test later
router.get('/get-user-details/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate userId
        if (!userId) {
            return res.status(400).json({ success: false, error: "User ID is required" });
        }

        const poolConnection = await sql.connect(config);

        // Query to fetch user details from ExtraUserDetails and Users tables
        const result = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    ExtraUserDetails.firstName,
                    ExtraUserDetails.lastName,
                    ExtraUserDetails.otherName,
                    ExtraUserDetails.gender,
                    ExtraUserDetails.phoneNumber,
                    ExtraUserDetails.contactEmail,
                    ExtraUserDetails.address,
                    ExtraUserDetails.LGA,
                    ExtraUserDetails.stateOfOrigin,
                    ExtraUserDetails.dob,
                    Users.userName,
                    Users.userEmail
                FROM dbo.ExtraUserDetails
                INNER JOIN dbo.Users ON ExtraUserDetails.userId = Users.userId
                WHERE ExtraUserDetails.userId = @userId
            `);

        poolConnection.close();

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        // Return the fetched user details
        res.status(200).json({ userDetails: result.recordset[0] });
    } catch (err) {
        console.error("Error fetching user details:", err.message);
        res.status(500).json({ success: false, error: "Failed to fetch user details" });
    }
});

// Endpoint to get the current logged-in user
router.get('/current-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success:false, message: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const poolConnection = await sql.connect(config);

        const result = await poolConnection.request()
            .input('userId', sql.Int, decoded.userId)
            .query('SELECT userId, userName, userEmail, adminId FROM dbo.Users WHERE userId = @userId');

        poolConnection.close();

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' }); 
        }

        const user = result.recordset[0];
        res.status(200).json({ success: true, message: 'User details fetched successfully', data: user });
    } catch (err) {
        console.error('Error fetching user details:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch user details' });
    }
});

// Endpoint to get all applications made by the logged-in user
router.get('/user-applications', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1]; // Extract the JWT token from the Authorization header
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized', data: {} }); // Return unauthorized if no token is provided
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to fetch all applications made by the logged-in user
        const result = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    BusinessInfo.businessName,
                    BusinessInfo.businessIndustry,
                    PersonalInfo.fullName AS applicantName
                FROM dbo.Applications
                INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                WHERE Applications.userId = @userId
            `);

        poolConnection.close(); // Close the database connection

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No applications found for the user', data: {} }); // Return not found if no applications exist
        }
    }
    catch (err) {
        console.error('Error fetching user applications:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Endpoint to get application statistics for the logged-in user
router.get('/application-stats', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1]; // Extract the JWT token from the Authorization header
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized', data: {} }); // Return unauthorized if no token is provided
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to get application statistics for the logged-in user
        const result = await poolConnection.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    COUNT(*) AS totalApplications,
                    SUM(CASE WHEN loanStatus = 'Pending' THEN 1 ELSE 0 END) AS pendingApplications,
                    SUM(CASE WHEN loanStatus = 'Approved2' THEN 1 ELSE 0 END) AS approvedApplications,
                    SUM(CASE WHEN loanStatus = 'Rejected2' THEN 1 ELSE 0 END) AS rejectedApplications
                FROM dbo.Applications
                WHERE userId = @userId
            `);

        poolConnection.close(); // Close the database connection

        const stats = result.recordset[0]; // Extract the statistics from the query result

        res.status(200).json({
            success: true,
            message: 'Application statistics retrieved successfully',
            data: stats
        }); // Return the statistics
    } catch (err) {
        console.error('Error fetching application statistics:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Endpoint to get application statistics across all users
router.get('/application-stats-overall',isAdmin, async (req, res) => {
    try {
        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to get application statistics across all users
        const result = await poolConnection.request().query(`
            SELECT 
                COUNT(*) AS totalApplications,
                SUM(CASE WHEN loanStatus = 'Pending' THEN 1 ELSE 0 END) AS pendingApplications,
                SUM(CASE WHEN loanStatus = 'Approved2' THEN 1 ELSE 0 END) AS approvedApplications,
                SUM(CASE WHEN loanStatus = 'Rejected2' THEN 1 ELSE 0 END) AS rejectedApplications
            FROM dbo.Applications
        `);

        poolConnection.close(); // Close the database connection

        const stats = result.recordset[0]; // Extract the statistics from the query result

        res.status(200).json({
            success: true,
            message: 'Overall application statistics retrieved successfully',
            data: stats
        }); // Return the statistics
    } catch (err) {
        console.error('Error fetching overall application statistics:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Endpoint to get the percentage of approved, rejected, and pending applications
router.get('/application-percentages', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config); // Connect to the database

        // Query to get the total number of applications and counts for each loanStatus category
        const result = await poolConnection.request().query(`
            SELECT 
                COUNT(*) AS totalApplications,
                SUM(CASE WHEN loanStatus = 'Accepted2' THEN 1 ELSE 0 END) AS approvedApplications,
                SUM(CASE WHEN loanStatus = 'Rejected2' THEN 1 ELSE 0 END) AS rejectedApplications,
                SUM(CASE WHEN loanStatus IN ('Pending', 'Resubmit', 'Accepted1', 'Rejected1') THEN 1 ELSE 0 END) AS pendingApplications
            FROM dbo.Applications
        `);

        poolConnection.close(); // Close the database connection

        const stats = result.recordset[0]; // Extract the statistics from the query result

        if (stats.totalApplications === 0) {
            return res.status(200).json({
                success: true,
                message: 'No applications found',
                data: {
                    approvedPercentage: 0,
                    rejectedPercentage: 0,
                    pendingPercentage: 0
                }
            });
        }

        // Calculate percentages
        const approvedPercentage = (stats.approvedApplications / stats.totalApplications) * 100;
        const rejectedPercentage = (stats.rejectedApplications / stats.totalApplications) * 100;
        const pendingPercentage = (stats.pendingApplications / stats.totalApplications) * 100;

        res.status(200).json({
            success: true,
            message: 'Application percentages retrieved successfully',
            data: {
                approvedPercentage: approvedPercentage.toFixed(2),
                rejectedPercentage: rejectedPercentage.toFixed(2),
                pendingPercentage: pendingPercentage.toFixed(2)
            }
        }); // Return the percentages
    } catch (err) {
        console.error('Error fetching application percentages:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});



export default router;