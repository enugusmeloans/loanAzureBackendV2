// This file defines the main application routes and handles database interactions.

import express from "express";
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from "node-fetch"; // Import fetch for making HTTP requests
import { sendEmail } from './emailService.js'; // Import the email service
import jwt from 'jsonwebtoken';
import multer from 'multer';
// import { uploadImage, generateSasUrl, deleteImage } from './azureBlobService.js';
import { uploadFile, listFiles, deleteFile, getSignedUrl } from './b2StorageService.js'; // Use Backblaze B2 instead
import { storeNotification } from "./notificationService.js";
import mysql from 'mysql2/promise';

dotenv.config();

const router = express.Router();

// Use Railway DATABASE_URI for all DB connections
const config = process.env.NODE_ENV === "production" ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI;
//------------------------------------------------------------------------
// Functions


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

        const poolConnection = await mysql.createConnection(config); // Connect to the database using MySQL connection
        const [rows] = await poolConnection.execute('SELECT adminId FROM Users WHERE userId = ?', [userId]);
        await poolConnection.end(); // Close the database connection

        if (rows.length === 0 || !rows[0].adminId) {
            return res.status(403).json({ success: false, message: 'Forbidden: User is not an admin', data: {} }); // Return forbidden if the user is not an admin
        }

        next(); // Proceed to the next middleware or route handler
    } catch (err) {
        console.error('Error checking admin status:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
}

const evaluateLoanEligibility = async (applicationData) => {
    const apiUrl = "https://loan-eligibility-api-production.up.railway.app/predict";

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
            console.log("Error:", response.statusText);
        }
    } catch (error) {
        console.log("Request failed:", error.message);
        // throw error; // Rethrow the error to be handled by the calling function
        // return "Error occurred while checking loan eligibility";
        const loanStatus = "Rejected1"; // Default to rejected if there's an error
        return loanStatus;
    }
};


//--------------------------------------------------------------------
//routes

// Endpoint to get all users 
router.get("/get-all-users", async (req, res) => {
    try {
        const poolConnection = await mysql.createConnection(config);
        const [rows] = await poolConnection.execute('SELECT userId, userName, userEmail, adminId FROM Users');
        await poolConnection.end();
        res.status(200).json({ success: true, message: 'Users fetched successfully', data: { users: rows } });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: 'Error fetching users', data: { error: err.message } });
    }
});

// Endpoint to promote a user to admin
router.post('/promote', async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await mysql.createConnection(config);
        const [result] = await poolConnection.execute('SELECT * FROM Users WHERE userEmail = ?', [email]);
        console.log("result", result);
        const user = result[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const adminId = crypto.randomBytes(3).toString('hex');
        console .log("setting adminId", adminId);
        await poolConnection.execute('UPDATE Users SET adminId = ? WHERE userId = ?', [adminId, user.userId]);
        console.log("Inserting into Admins table with adminId", adminId);
        await poolConnection.execute('INSERT INTO Admins (adminId, userId, fullName, email) VALUES (?, ?, ?, ?)', [adminId, user.userId, user.userName, user.userEmail]);
        console.log("User promoted to admin successfully");
        poolConnection.close();
        res.status(200).json({ success: true, message: 'User promoted to admin', data: { adminId } });
    } catch (err) {
        console.error("Error promoting user to admin",err.message);
        res.status(500).json({ success: false, message: 'Error promoting user', data: { error: err.message } });
    }
});

// Endpoint to demote an admin to user
router.post('/demote', async (req, res) => {
    const { email } = req.body;
    try {
        const poolConnection = await mysql.createConnection(config);
        const [result] = await poolConnection.execute('SELECT * FROM Users WHERE userEmail = ?', [email]);

        const user = result[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).json({ error: 'User not found' });
        }

        await poolConnection.execute('DELETE FROM Admins WHERE adminId = ?', [user.adminId]);

        await poolConnection.execute('UPDATE Users SET adminId = NULL WHERE userId = ?', [user.userId]);

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
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await mysql.createConnection(config); // Connect to the database

        // Query to check if the user is an admin
        const [result] = await poolConnection.execute('SELECT adminId FROM Users WHERE userId = ?', [userId]);

        await poolConnection.end(); // Close the database connection

        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found', data: {} }); // Return not found if the user does not exist
        }

        const isAdmin = result[0].adminId !== null; // Check if the adminId is not null

        res.status(200).json({ success: true, message: 'Admin status retrieved successfully', data: { isAdmin } }); // Return the admin status
    } catch (err) {
        console.error('Error checking admin status:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Updated /submit-application route to check for user details in ExtraUserDetails table
router.post('/submit-application', isAuthenticated, async (req, res) => {
    const { userEmail, personalInfo, businessInfo, financeInfo, challengeInfo, loanInfo, regulatoryInfo, dateSubmitted } = req.body;
    console.log("Submit Application Body: ",req.body)
    // Validate the request body
    const requiredFields = [
        { key: "userEmail", type: "string" },
        { key: "personalInfo", type: "object" },
        { key: "businessInfo", type: "object" },
        { key: "financeInfo", type: "object" },
        { key: "challengeInfo", type: "object" },
        { key: "loanInfo", type: "object" },
        { key: "regulatoryInfo", type: "object" },
        { key: "dateSubmitted", type: "string" }
    ];

    for (const field of requiredFields) {
        if (!req.body[field.key] || typeof req.body[field.key] !== field.type) {
            return res.status(400).json({ success: false, message: `Invalid or missing field: ${field.key}` });
        }
    }

    // Validate nested objects
    const validateNestedFields = (obj, fields, parentKey) => {
        for (const field of fields) {
            if (!obj[field.key] || typeof obj[field.key] !== field.type) {
                return `Invalid or missing field: ${parentKey}.${field.key}`;
            }
        }
        return null;
    };

    const personalInfoFields = [
        { key: "residentAddress", type: "string" },
        { key: "personalState", type: "string" },
        { key: "BVN", type: "number" },
        { key: "NIN", type: "number" }
    ];

    const businessInfoFields = [
        { key: "businessName", type: "string" },
        { key: "businessAddress", type: "string" },
        { key: "businessAge", type: "string" },
        { key: "businessType", type: "string" },
        { key: "businessIndustry", type: "string" },
        { key: "businessLGA", type: "string" },
        { key: "businessTown", type: "string" }
    ];

    const financeInfoFields = [
        { key: "bankAccountQuestion", type: "string" },
        { key: "digitalPaymentQuestion", type: "string" },
        { key: "businessFinanceQuestion", type: "string" }
    ];

    const challengeInfoFields = [
        { key: "biggestChallengeQuestion", type: "string" },
        { key: "govtSupportQuestion", type: "string" },
        { key: "businessGrowthQuestion", type: "string" }
    ];

    const loanInfoFields = [
        { key: "loanBeforeQuestion", type: "string" },
        { key: "loanHowQuestion", type: "string" },
        { key: "whyNoLoan", type: "string" }
    ];

    const regulatoryInfoFields = [
        { key: "regulatoryChallengeQuestion", type: "string" }
    ];

    const nestedValidations = [
        { obj: req.body.personalInfo, fields: personalInfoFields, parentKey: "personalInfo" },
        { obj: req.body.businessInfo, fields: businessInfoFields, parentKey: "businessInfo" },
        { obj: req.body.financeInfo, fields: financeInfoFields, parentKey: "financeInfo" },
        { obj: req.body.challengeInfo, fields: challengeInfoFields, parentKey: "challengeInfo" },
        { obj: req.body.loanInfo, fields: loanInfoFields, parentKey: "loanInfo" },
        { obj: req.body.regulatoryInfo, fields: regulatoryInfoFields, parentKey: "regulatoryInfo" }
    ];

    for (const validation of nestedValidations) {
        const error = validateNestedFields(validation.obj, validation.fields, validation.parentKey);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }
    }

    try {
        const poolConnection = await mysql.createConnection(config);

        // Check for similar applications
        const [similarApplicationResult] = await poolConnection.execute(`
                SELECT dateSubmitted 
                FROM Applications 
                INNER JOIN BusinessInfo 
                ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN Users 
                ON Applications.userId = Users.userId
                WHERE Users.userEmail = ? 
                AND BusinessInfo.businessName = ? 
                AND BusinessInfo.businessIndustry = ?
            `, [userEmail, businessInfo.businessName, businessInfo.businessIndustry]);

        if (similarApplicationResult.length > 0) {
            const lastApplicationDate = new Date(similarApplicationResult[0].dateSubmitted);
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

        // Start transaction
        await poolConnection.beginTransaction();

        // Get userId from userEmail
        const [userResult] = await poolConnection.execute('SELECT userId FROM Users WHERE userEmail = ?', [userEmail]);

        if (userResult.length === 0) {
            await poolConnection.rollback();
            await poolConnection.close();
            return res.status(404).json({ success: false, message: 'User not found', data: {} });
        }

        const userId = userResult[0].userId;

        // Fetch user details from ExtraUserDetails table
        const [extraDetailsResult] = await poolConnection.execute(`
                SELECT firstName, lastName, otherName, dob, gender, LGA, contactEmail AS email, phoneNumber AS phone
                FROM ExtraUserDetails
                WHERE userId = ?
            `, [userId]);
            console.log("extraDetailsResult", extraDetailsResult, userId);
        // Check if all required fields are not empty or false
        const requiredFields = ['firstName', 'lastName', 'otherName', 'dob', 'gender', 'LGA', 'email', 'phone'];
        const extraDetails = extraDetailsResult[0];
        console.log("extraDetails", extraDetails, userId);
        if (!extraDetails || requiredFields.some(field => !extraDetails[field] || !String(extraDetails[field]).trim())) {
            await poolConnection.rollback();
            await poolConnection.close();
            return res.status(400).json({ success: false, message: 'Please complete your profile first with valid data', data: {verified: false} });
        }

        if (extraDetailsResult.length === 0) {
            await poolConnection.rollback();
            await poolConnection.close();
            return res.status(400).json({ success: false, message: 'Please complete your profile first', data: { verified: false } });
        }

        const personalExtraInfo = extraDetailsResult[0];
        console.log("personalExtraInfo", personalExtraInfo);
        console.log("personalInfo", personalInfo);
        console.log("Things to insert into Applications Table",userId, new Date(dateSubmitted), loanStatus)
        // Insert into Applications table and get the generated applicationId
        const [applicationResult] = await poolConnection.execute('INSERT INTO Applications (userId, dateSubmitted, loanStatus) VALUES (?, ?, ?)',
            [userId, new Date(dateSubmitted), loanStatus]);
            console.log("inserted into Applications table with applicationId:", applicationResult.insertId);
        const applicationId = applicationResult.insertId;
            console.log("inserting into PersonalInfo table with applicationId:", applicationId);
        // Insert into PersonalInfo table using details from ExtraUserDetails
        await poolConnection.execute(`
            INSERT INTO PersonalInfo (applicationId, fullName, dob, gender, email, phone, residentAddress, LGA, state, BVN, NIN)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [applicationId, `${personalExtraInfo.firstName} ${personalExtraInfo.lastName} ${personalExtraInfo.otherName}`, personalExtraInfo.dob, personalExtraInfo.gender, personalExtraInfo.email, personalExtraInfo.phone, personalInfo.residentAddress, personalExtraInfo.LGA, personalInfo.personalState, personalInfo.BVN, personalInfo.NIN]);
            console.log("PersonalInfo inserted successfully");
        // Insert into BusinessInfo table
        await poolConnection.execute(`
            INSERT INTO BusinessInfo (applicationId, businessName, businessAddress, businessAge, businessType, businessIndustry, businessLGA, businessTown)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [applicationId, businessInfo.businessName, businessInfo.businessAddress, businessInfo.businessAge, businessInfo.businessType, businessInfo.businessIndustry, businessInfo.businessLGA, businessInfo.businessTown]);

        // Insert into FinanceInfo table
        await poolConnection.execute(`
            INSERT INTO FinanceInfo (applicationId, bankAccountQuestion, digitalPaymentQuestion, businessFinanceQuestion)
            VALUES (?, ?, ?, ?)
        `, [applicationId, financeInfo.bankAccountQuestion, financeInfo.digitalPaymentQuestion, financeInfo.businessFinanceQuestion]);

        // Insert into ChallengeInfo table
        await poolConnection.execute(`
            INSERT INTO ChallengeInfo (applicationId, biggestChallengeQuestion, govtSupportQuestion, businessGrowthQuestion)
            VALUES (?, ?, ?, ?)
        `, [applicationId, challengeInfo.biggestChallengeQuestion, challengeInfo.govtSupportQuestion, challengeInfo.businessGrowthQuestion]);

        // Insert into LoanInfo table
        await poolConnection.execute(`
            INSERT INTO LoanInfo (applicationId, loanBeforeQuestion, loanHowQuestion, whyNoLoan)
            VALUES (?, ?, ?, ?)
        `, [applicationId, loanInfo.loanBeforeQuestion, loanInfo.loanHowQuestion, loanInfo.whyNoLoan]);

        // Insert into RegulatoryInfo table
        await poolConnection.execute(`
            INSERT INTO RegulatoryInfo (applicationId, regulatoryChallengeQuestion)
            VALUES (?, ?)
        `, [applicationId, regulatoryInfo.regulatoryChallengeQuestion]);

        await poolConnection.commit();

        // Fetch the details of the submitted application
        const [applicationSubmittedResult] = await poolConnection.execute(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    BusinessInfo.businessName,
                    BusinessInfo.businessIndustry,
                    PersonalInfo.fullName AS applicantName
                FROM Applications
                INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                WHERE Applications.applicationId = ?
            `, [applicationId]);

        const applicationSResult = applicationSubmittedResult[0];

        poolConnection.close();

        // Check the loan status and respond accordingly
        if (loanStatus === "Rejected1") {
            // Send notification to the user about the rejection
            await storeNotification("Loan Application Rejected", userId, `Dear ${personalExtraInfo.firstName}, your loan application has been rejected based on the eligibility criteria.`);

            // Send email to the user about the rejection
            await
            sendEmail({
                to: personalExtraInfo.email,
                subject: "Loan Application Rejected",
                text: `Dear ${personalExtraInfo.firstName},\n\nYour loan application has been rejected based on the eligibility criteria.\n\nBest regards,\nLoan Application Team`
            });
            // send a rejected response back to the user with the application details
            return res.status(200).json({ success: true, message: "Application submitted but rejected based on eligibility criteria", data:{ status: "Rejected", ...applicationSResult} });
        }
        
        // Send notification to the user about the successful application submission
        await storeNotification("Loan Application Submitted", userId, `Dear ${personalExtraInfo.firstName}, your loan application has been submitted successfully. Please proceed to upload your documents.`);

        // Send email to the user about the successful application submission
        await
        sendEmail({
            to: personalExtraInfo.email,
            subject: "Loan Application Submitted",
            text: `Dear ${personalExtraInfo.firstName},\n\nYour loan application has been submitted successfully. Please proceed to upload your documents\n\nBest regards,\nLoan Application Team`
        });
        // send an accepted response back to the user with the application details
        res.status(200).json({ success: true, message: 'Application submitted successfully', data:{status: "Accepted", ...applicationSResult} });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: 'Error submitting application', data: { error: err.message } });
    }
});

// Modified /get-all-applications endpoint to handle pagination
router.post('/get-all-applications',isAdmin, async (req, res) => {
    const { From, To } = req.body; // Extract From and To values from the request body
    // Validate input values
    if (!Number.isInteger(From) || !Number.isInteger(To) || From < 1 || To < 1 || To < From) {
        return res.status(400).json({ success: false, message: 'Invalid From or To values', data: {} });
    }

    try {
        const poolConnection = await mysql.createConnection(config); // Connect to the database

        // Query to get the total number of applications
        const [totalResult] = await poolConnection.execute('SELECT COUNT(*) AS totalApplications FROM Applications');
        console.log("Query to get total applications executed successfully");
        const totalApplications = totalResult[0].totalApplications;

        if (From > totalApplications) {
            return res.status(400).json({ success: false, message: 'From value exceeds total number of applications', data: { totalApplications:totalApplications } }); // Validate start value
        }

        const adjustedTo = Math.min(To, totalApplications); // Adjust end value if it exceeds total applications
        console.log("Adjusted To value:", adjustedTo);

        const offset = From - 1; // Calculate the starting index for pagination
        const limit = adjustedTo - From + 1; // Calculate the number of records to fetch
        console.log("offset:", offset, "limit:", limit);

        console.log("offset:", offset, typeof offset);
        console.log("limit:", limit, typeof limit);

        // Query to fetch applications within the specified range
        const [result] = await poolConnection.execute(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    BusinessInfo.businessName,
                    PersonalInfo.fullName AS applicantName,
                    Applications.loanStatus
                FROM Applications
                INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                ORDER BY Applications.applicationId
                LIMIT ${offset}, ${limit}
            `);
        console.log("Query to fetch applications executed successfully");
        console.log("Fetched applications:", result);
        poolConnection.close(); // Close the database connection

        res.status(200).json({
            success: true,
            message: 'Applications retrieved successfully',
            data: { applications: result, totalApplications: totalApplications, From: From, To: adjustedTo } // Return the applications and total count
        }); // Return the applications
    } catch (err) {
        console.error('Error fetching applications:', err); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
});

// Endpoint to get details of all applications - dont postman yet till after deploy testing
router.get('/get-every-applications',isAdmin, async (req, res) => {
    try {
        const poolConnection = await mysql.createConnection(config);

        // Query to fetch the required details of all applications
        const [result] = await poolConnection.execute(`
            SELECT 
                Applications.applicationId,
                Applications.dateSubmitted,
                BusinessInfo.businessName,
                PersonalInfo.fullName AS applicantName,
                Users.userName AS userName,
                Applications.loanStatus
            FROM Applications
            INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN Users ON Applications.userId = Users.userId
        `);

        poolConnection.close();

        // Return the fetched data as a JSON object with an array of applications.
        res.status(200).json({ success: true, message:"Applications Fetched Successfully", data: { applications: result } });
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

        const poolConnection = await mysql.createConnection(config);

        // Query to fetch all details of the application, including CAC, BVN, and NIN
        const [result] = await poolConnection.execute(`
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
                FROM Applications
                INNER JOIN Users ON Applications.userId = Users.userId
                INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
                INNER JOIN ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
                INNER JOIN LoanInfo ON Applications.applicationId = LoanInfo.applicationId
                INNER JOIN RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
                WHERE Applications.applicationId = ?
            `, [applicationId]);

        poolConnection.close();

        if (result.length === 0) {
            return res.status(404).json({ succes: false, message: "Application not found" });
        }

        // Return the fetched application details
        res.status(200).json({ success: true, message:"Application details", data: {applicationDetails: result[0]} });
    } catch (err) {
        console.error("Error fetching application details:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch application details" });
    }
});

// Endpoint for admin to accept an application - postman later
router.post('/accept-application', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;
        console.log("Accept Application Body:", req.body);

        // Validate applicationId and emailBody
        if (!applicationId || !emailBody) {
            console.log("Application ID or email body is missing");
            return res.status(400).json({ error: "Application id and emailBody is required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Check the current loanStatus of the application
        const [applicationResult] = await poolConnection.execute(`
                SELECT loanStatus, userEmail 
                FROM Applications 
                INNER JOIN Users ON Applications.userId = Users.userId
                WHERE applicationId = ?
            `, [applicationId]);

        if (applicationResult.length === 0) {
            poolConnection.close();
            console.log("Application not found for ID:", applicationId);
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult[0];

        // Ensure the application is currently "Pending"
        if (loanStatus !== "Pending" || loanStatus !== "Rejected2" ) {
            poolConnection.close();
            console.log("Application is not in 'Pending' status for ID:", applicationId, "loanStatus:" , loanStatus);
            return res.status(400).json({ success: false, message: "Only applications with a 'Pending' status can be accepted" });
        }

        // Update the loanStatus to "Accepted2"
        await poolConnection.execute(`
                UPDATE Applications 
                SET loanStatus = ? 
                WHERE applicationId = ?
            `, ["Accepted2", applicationId]);

        poolConnection.close();
        
        // Use the applicationId to get the userId
        const [userResult] = await poolConnection.execute('SELECT userId FROM Applications WHERE applicationId = ?', [applicationId]);
        const userId = userResult[0].userId;
        // Send notification to the user about the acceptance
        await storeNotification("Loan Application Accepted", userId, `Dear User, your loan application has been accepted. Please check your email for further steps.`);

        // Send email to the user
        await sendEmail(userEmail, "Application Accepted", emailBody);
        console.log("Application accepted successfully and email sent to:", userEmail);
        res.status(200).json({ success: true, message: "Application accepted successfully and email sent", data: { applicationId:applicationId, loanStatus: "Accepted2"} });
    } catch (err) {
        console.error("Error accepting application:", err.message);
        res.status(500).json({ success: false, message: "Failed to accept application" });
    }
});

// Endpoint for admin to reject an application
router.post('/reject-application', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;
        console.log("Reject Application Body:", req.body);

        // Validate applicationId and emailBody
        if (!applicationId || !emailBody) {
            console.log("Application ID or email body is missing");
            return res.status(400).json ({ error: "Application ID and email body are required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Check the current loanStatus of the application
        const [applicationResult] = await poolConnection.execute(`
                SELECT loanStatus, userEmail 
                FROM Applications 
                INNER JOIN Users ON Applications.userId = Users.userId
                WHERE applicationId = ?
            `, [applicationId]);

        if (applicationResult.length === 0) {
            poolConnection.close();
            console.log("Application not found for ID:", applicationId);
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult[0];

        // Ensure the application is currently "Pending"
        if (loanStatus !== "Pending" || loanStatus !== "Accepted2" ) {
            poolConnection.close();
            console.log("Application is not in 'Pending' status for ID:", applicationId, "loanStatus:" , loanStatus);
            return res.status(400).json({ error: "Only applications with a 'Pending' status can be rejected" });
        }

        // Update the loanStatus to "Rejected2"
        await poolConnection.execute(`
                UPDATE Applications 
                SET loanStatus = ? 
                WHERE applicationId = ?
            `, ["Rejected2", applicationId]);

        poolConnection.close();

        // Use the applicationId to get the userId
        const [userResult] = await poolConnection.execute('SELECT userId FROM Applications WHERE applicationId = ?', [applicationId]);
        const userId = userResult[0].userId;
        // Send notification to the user about the rejection
        await storeNotification("Loan Application Rejected", userId, `Dear User, your loan application has been rejected. Please check your email for further details.`);

        // Send email to the user
        await sendEmail(userEmail, "Application Rejected", emailBody);

        res.status(200).json({ success:true, message: "Application rejected successfully and email sent", data: { applicationId:applicationId, loanStatus: "Rejected2" } });
    } catch (err) {
        console.error("Error rejecting application:", err.message);
        res.status(500).json({ error: "Failed to reject application" });
    }
});

// Endpoint to resubmit an application
router.post('/resubmit-application', async (req, res) => {
    let poolConnection;
    try {
        const {
            userEmail,
            applicationId,
            personalInfo,
            businessInfo,
            financeInfo,
            challengeInfo,
            loanInfo,
            regulatoryInfo
        } = req.body;

        console.log("Resubmit Application Body:", req.body);

        poolConnection = await mysql.createConnection(config);

        // Step 1: Get userId
        const [userResult] = await poolConnection.execute(
            'SELECT userId FROM Users WHERE userEmail = ?',
            [userEmail]
        );

        if (userResult.length === 0) {
            console.log("User not found for email:", userEmail);
            return res.status(404).json({ success: false, message: 'User not found', data: {} });
        }

        const userId = userResult[0].userId;

        // Step 2: Check if user has completed profile
        const [extraDetailsResult] = await poolConnection.execute(`
            SELECT firstName, lastName, otherName, dob, gender, LGA, contactEmail AS email, phoneNumber AS phone
            FROM ExtraUserDetails
            WHERE userId = ?
        `, [userId]);

        const extraDetails = extraDetailsResult[0];
        const requiredFields = ['firstName', 'lastName', 'otherName', 'dob', 'gender', 'LGA', 'email', 'phone'];

        if (!extraDetails || requiredFields.some(field => !extraDetails[field] || !String(extraDetails[field]).trim())) {
            console.log("Incomplete profile for user:", userId);
            return res.status(400).json({ success: false, message: 'Please complete your profile first with valid data', data: {} });
        }

        // Step 3: Validate applicationId and status
        if (!applicationId) {
            console.log("Application ID is missing");
            return res.status(400).json({ error: "Application ID is required" });
        }

        const [applicationResult] = await poolConnection.execute(`
            SELECT loanStatus 
            FROM Applications 
            WHERE applicationId = ?
        `, [applicationId]);

        if (applicationResult.length === 0) {
            console.log("Application not found for ID:", applicationId);
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        const { loanStatus } = applicationResult[0];
        if (loanStatus !== "Resubmit") {
            console.log("Application is not in 'Resubmit' status for ID:", applicationId);
            return res.status(400).json({ success: false, message: "Only applications with a 'Resubmit' status can be resubmitted" });
        }

        // Step 4: Begin transaction
        await poolConnection.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await poolConnection.beginTransaction();

        try {
            // Step 5: Update application status
            await poolConnection.execute(`
                UPDATE Applications 
                SET loanStatus = ? 
                WHERE applicationId = ?
            `, ["Accepted1", applicationId]);

            // Step 6: Update PersonalInfo
            await poolConnection.execute(`
                UPDATE PersonalInfo 
                SET fullName = ?, dob = ?, gender = ?, email = ?, 
                    phone = ?, residentAddress = ?, LGA = ?, 
                    state = ?, BVN = ?, NIN = ? 
                WHERE applicationId = ?
            `, [
                `${extraDetails.firstName} ${extraDetails.lastName} ${extraDetails.otherName}`,
                extraDetails.dob,
                extraDetails.gender,
                extraDetails.email,
                extraDetails.phone,
                personalInfo.residentAddress,
                extraDetails.LGA,
                personalInfo.personalState,
                personalInfo.BVN,
                personalInfo.NIN,
                applicationId
            ]);

            // Step 7: Update BusinessInfo
            await poolConnection.execute(`
                UPDATE BusinessInfo 
                SET businessName = ?, businessAddress = ?, 
                    businessAge = ?, businessType = ?, 
                    businessIndustry = ?, businessLGA = ?, 
                    businessTown = ? 
                WHERE applicationId = ?
            `, [
                businessInfo.businessName,
                businessInfo.businessAddress,
                businessInfo.businessAge,
                businessInfo.businessType,
                businessInfo.businessIndustry,
                businessInfo.businessLGA,
                businessInfo.businessTown,
                applicationId
            ]);

            // Step 8: Update FinanceInfo
            await poolConnection.execute(`
                UPDATE FinanceInfo 
                SET bankAccountQuestion = ?, 
                    digitalPaymentQuestion = ?, 
                    businessFinanceQuestion = ? 
                WHERE applicationId = ?
            `, [
                financeInfo.bankAccountQuestion,
                financeInfo.digitalPaymentQuestion,
                financeInfo.businessFinanceQuestion,
                applicationId
            ]);

            // Step 9: Update ChallengeInfo
            await poolConnection.execute(`
                UPDATE ChallengeInfo 
                SET biggestChallengeQuestion = ?, 
                    govtSupportQuestion = ?, 
                    businessGrowthQuestion = ? 
                WHERE applicationId = ?
            `, [
                challengeInfo.biggestChallengeQuestion,
                challengeInfo.govtSupportQuestion,
                challengeInfo.businessGrowthQuestion,
                applicationId
            ]);

            // Step 10: Update LoanInfo
            await poolConnection.execute(`
                UPDATE LoanInfo 
                SET loanBeforeQuestion = ?, 
                    loanHowQuestion = ?, 
                    whyNoLoan = ? 
                WHERE applicationId = ?
            `, [
                loanInfo.loanBeforeQuestion,
                loanInfo.loanHowQuestion,
                loanInfo.whyNoLoan,
                applicationId
            ]);

            // Step 11: Update RegulatoryInfo
            await poolConnection.execute(`
                UPDATE RegulatoryInfo 
                SET regulatoryChallengeQuestion = ? 
                WHERE applicationId = ?
            `, [
                regulatoryInfo.regulatoryChallengeQuestion,
                applicationId
            ]);

            // Step 12: Commit transaction
            await poolConnection.commit();

        } catch (updateErr) {
            console.error("Update error:", updateErr.message);
            await poolConnection.rollback();
            return res.status(500).json({ success: false, message: "Error updating application data", data: { error: updateErr.message } });
        }

        // Step 13: Fetch resubmitted application
        const [applicationSubmittedResult] = await poolConnection.execute(`
            SELECT 
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                BusinessInfo.businessName,
                BusinessInfo.businessIndustry,
                PersonalInfo.fullName AS applicantName
            FROM Applications
            INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            WHERE Applications.applicationId = ?
        `, [applicationId]);

        const applicationSResult = applicationSubmittedResult[0];

        await poolConnection.close();
        console.log("Application resubmitted successfully for ID:", applicationId);
        return res.status(200).json({
            success: true,
            message: 'Application resubmitted successfully',
            data: { application: applicationSResult }
        });

    } catch (err) {
        console.error('Unexpected error:', err.message);
        if (poolConnection) {
            try {
                await poolConnection.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr.message);
            }
            await poolConnection.close();
        }
        return res.status(500).json({
            success: false,
            message: 'Failed to resubmit application',
            data: { error: err.message }
        });
    }
});


// Endpoint for admin to request resubmission of an application
router.post('/request-resubmission', isAdmin, async (req, res) => {
    try {
        const { applicationId, emailBody } = req.body;
        console.log("Request Resubmission Body:", req.body);

        // Validate applicationId
        if (!applicationId) {
            console.log("Application ID is missing");
            return res.status(400).json({ success: false, error: "Application ID is required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Check the current loanStatus of the application
        const [applicationResult] = await poolConnection.execute(`
                SELECT loanStatus, userEmail 
                FROM Applications 
                INNER JOIN Users ON Applications.userId = Users.userId
                WHERE applicationId = ?
            `, [applicationId]);

        if (applicationResult.length === 0) {
            poolConnection.close();
            console.log("Application not found for ID:", applicationId);
            return res.status(404).json({ success: false, error: "Application not found" });
        }

        const { loanStatus, userEmail } = applicationResult[0];
        console.log("Current loanStatus:", loanStatus);

        // Ensure the application is not already in "Resubmit" status
        if (loanStatus === "Resubmit") {
            poolConnection.close();
            console.log("Application is already in 'Resubmit' status for ID:", applicationId, "loanStatus:" , loanStatus);
            return res.status(400).json({ success: false, error: "Application is already in 'Resubmit' status" });
        }

        // Update the loanStatus to "Resubmit"
        await poolConnection.execute(`
                UPDATE Applications 
                SET loanStatus = ? 
                WHERE applicationId = ?
            `, ["Resubmit", applicationId]);

        

        // Use the applicationId to get the userId
        const [userResult] = await poolConnection.execute('SELECT userId FROM Applications WHERE applicationId = ?', [applicationId]);
        const userId = userResult[0].userId;

        poolConnection.close();

        // Send notification to the user about the resubmission request
        await storeNotification("Loan Application Resubmission Requested", userId, `Dear User, your loan application has been marked for resubmission. Please check your email for clarification and proceed to resubmit your application details.`);

        // Send email to the user
        await sendEmail(userEmail, "Resubmission Requested", emailBody);

        res.status(200).json({ success: true, message: "Resubmission requested successfully and email sent", data: {applicationId: applicationId, loanStatus: "Resubmit"} });
    } catch (err) {
        console.error("Error requesting resubmission:", err.message);
        res.status(500).json({ success: false, error: "Failed to request resubmission" });
    }
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Updated /extra-user-details endpoint to handle profile picture upload
router.post('/extra-user-details', async (req, res) => {
    console.log("extra user body",req.body)
    try {
        const { userId, firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin, dob } = req.body;
        console.log("Received request body:", req.body);

        // Check if all required fields are provided and valid
        if (!userId || !firstName || !lastName || !otherName || !gender || !phoneNumber || !contactEmail || !address || !LGA || !stateOfOrigin || !dob) {
            console.log("Missing required fields in request body");
            return res.status(400).json({ success: false, error: "All fields are required", data: { verified: false } });
        }

        // Ensure none of the fields have empty or false values
        if (
            !String(userId).trim() || !String(firstName).trim() || !String(lastName).trim() || 
            !String(otherName).trim() || !String(gender).trim() || !String(phoneNumber).trim() || 
            !String(contactEmail).trim() || !String(address).trim() || !String(LGA).trim() || 
            !String(stateOfOrigin).trim() || !String(dob).trim()
        ) {
            console.log("One or more fields are empty or false");
            return res.status(400).json({ success: false, error: "Fields cannot be empty or false", data: { verified: false } });
        }
        // Convert dob to a Date object
        const dobDate = new Date(dob);

        const poolConnection = await mysql.createConnection(config);

        // Check if the record exists in ExtraUserDetails
        const [existingRecordResult] = await poolConnection.execute('SELECT * FROM ExtraUserDetails WHERE userId = ?', [userId]);

        const existingRecord = existingRecordResult[0];

        if (existingRecord) {
            // Update the record in ExtraUserDetails
            await poolConnection.execute(`
                UPDATE ExtraUserDetails
                SET firstName = ?, lastName = ?, otherName = ?,
                    gender = ?, phoneNumber = ?, contactEmail = ?,
                    address = ?, LGA = ?, stateOfOrigin = ?, dob = ?
                WHERE userId = ?
            `, [firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin, dobDate, userId]);

            // Update userName in Users table
            const updatedUserName = `${firstName} ${lastName}`;
            await poolConnection.execute('UPDATE Users SET userName = ? WHERE userId = ?', [updatedUserName, userId]);
        } else {
            // Insert a new record into ExtraUserDetails
            await poolConnection.execute(`
                INSERT INTO ExtraUserDetails (userId, firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin, dob)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, firstName, lastName, otherName, gender, phoneNumber, contactEmail, address, LGA, stateOfOrigin, dobDate]);

            // Update userName in Users table
            const updatedUserName = `${firstName} ${lastName}`;
            await poolConnection.execute('UPDATE Users SET userName = ? WHERE userId = ?', [updatedUserName, userId]);
        }


        poolConnection.close();
        console.log("User details updated successfully for userId:", userId);
        res.status(200).json({ success: true, message: "User details updated successfully", data:{ verified: true, userId: userId, firstName: firstName, lastName: lastName, otherName: otherName, dob:dob, phoneNumber: phoneNumber, contactEmail: contactEmail, address: address, LGA: LGA, stateOfOrigin: stateOfOrigin }});
    } catch (err) {
        console.error("Error updating user details:", err);
        res.status(500).json({ success: false, error: "Failed to update user details", data: {verified: false} });
    }
});


// Endpoint to upload a profile picture
router.post('/upload-profile-picture', isAuthenticated, upload.single("profilePicture"), async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Upload to Backblaze B2
        const fileName = await uploadFile(file);
        const poolConnection = await mysql.createConnection(config);
        // Update the user's profile picture fileName in the database
        await poolConnection.execute('UPDATE ExtraUserDetails SET profilePicture = ? WHERE userId = ?', [fileName, userId]);
        poolConnection.close();
        console.log("Profile picture uploaded successfully:", fileName);
        // Return success response
        res.status(200).json({ success: true, message: 'Profile picture uploaded successfully', data: { fileName } });
    } catch (err) {
        console.error('Error uploading profile picture:', err.message);
        res.status(500).json({ error: 'Failed to upload profile picture' });
    }
});

router.get('/get-user-details/:userId', async (req, res) => {
    console.log("Fetching user details...", req.params.userId);
    let poolConnection;
    let poolConnection1;

    try {
        const { userId } = req.params;

        // Validate userId
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: "User ID is required", 
                data: { verified: false } 
            });
        }

        poolConnection1 = await mysql.createConnection(config);
        console.log("Hello from get-user-details endpoint");

        // Query to fetch user details from Users table
        const [userResult] = await poolConnection1.execute(`
                SELECT 
                    userName,
                    userEmail
                FROM Users
                WHERE userId = ?
            `, [userId]);

        if (userResult.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "User not found", 
                data: { verified: false } 
            });
        }

        poolConnection = await mysql.createConnection(config);

        // Query to fetch extra user details
        const [extraDetailsResult] = await poolConnection.execute(`
                SELECT 
                    firstName,
                    lastName,
                    otherName,
                    gender,
                    phoneNumber,
                    contactEmail,
                    address,
                    LGA,
                    stateOfOrigin,
                    dob,
                    profilePicture
                FROM ExtraUserDetails
                WHERE userId = ?
            `, [userId]);

        // Check if extra details are available
        if (extraDetailsResult.length === 0) {
            return res.status(200).json({ 
                success: true, 
                message: "User details not complete", 
                data: { verified: false } 
            });
        }
        // Check if all required fields in ExtraUserDetails are not empty or false
        const requiredFields = ['firstName', 'lastName', 'otherName', 'gender', 'phoneNumber', 'contactEmail', 'address', 'LGA', 'stateOfOrigin', 'dob'];
        const extraDetails = extraDetailsResult[0];

        if (!extraDetails || requiredFields.some(field => !extraDetails[field] || !String(extraDetails[field]).trim())) {
            return res.status(400).json({ 
                success: false, 
                message: "Please complete your profile with valid data", 
                data: { verified: false } 
            });
        }

        // Check if the profile picture fileName is valid
        const profilePictureFileName = extraDetailsResult[0].profilePicture;
        if (profilePictureFileName) {
            const signedUrl = await getSignedUrl(profilePictureFileName);
            console.log("Profile picture signed URL:", signedUrl);
            extraDetailsResult[0].profilePicture = signedUrl;
        }

        // Combine and return user details
        const userDetails = {
            ...userResult[0],
            ...extraDetailsResult[0]
        };

        res.status(200).json({ 
            success: true, 
            message: "Fetched user details", 
            data: { verified: true, userDetails } 
        });

    } catch (err) {
        console.error("Error fetching user details:", err.message);
        res.status(500).json({ 
            success: false, 
            error: "Failed to fetch user details", 
            data: { verified: false } 
        });
    } finally {
        if (poolConnection) await poolConnection.close();
        if (poolConnection1) await poolConnection1.close();
    }
});


// Endpoint to get the current logged-in user
router.get('/current-user', async (req, res) => {
    console.log("Fetching current user details...");
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        console.log("No token provided in request headers");
        return res.status(401).json({ success:false, message: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const poolConnection = await mysql.createConnection(config);
        console.log("Getting current user. Connection Created. Now getting user details...", decoded.userId);

        // Sanitize decoded.userId
        if (!Number.isInteger(decoded.userId) || decoded.userId <= 0) {
            await poolConnection.close();
            console.log("Invalid userId:", decoded.userId);
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        const [result] = await poolConnection.execute(`SELECT userId, userName, userEmail, adminId FROM Users WHERE userId = ${decoded.userId}`);
        console.log("Result for current user:", result); // Log the result for debugging

        poolConnection.close();

        if (result.length === 0) {
            console.log("User not found for userId:", decoded.userId);
            return res.status(404).json({ success: false, message: 'User not found' }); 
        }

        const user = result[0];
        console.log("Current user details fetched successfully:", user);
        res.status(200).json({ success: true, message: 'User details fetched successfully', data: user });
    } catch (err) {
        console.error('Error fetching user details:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch user details' });
    }
});

// Endpoint to get all applications made by the logged-in user
router.get('/user-applications', async (req, res) => {
    console.log("Fetching user applications...");
    const token = req.headers.authorization?.split(' ')[1]; // Extract the JWT token from the Authorization header
    if (!token) {
        console.log("No token provided in request headers");
        return res.status(401).json({ success: false, message: 'Unauthorized', data: {} }); // Return unauthorized if no token is provided
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify and decode the JWT token
        const userId = decoded.userId; // Extract the userId from the decoded token

        const poolConnection = await mysql.createConnection(config); // Connect to the database
        console.log("Fetching user applications for userId:", userId); // Log the userId for debugging

        // Query to fetch all applications made by the logged-in user
        const [result] = await poolConnection.execute(`
                SELECT 
                    Applications.applicationId,
                    Applications.dateSubmitted,
                    Applications.loanStatus,
                    BusinessInfo.businessName,
                    BusinessInfo.businessIndustry,
                    PersonalInfo.fullName AS applicantName
                FROM Applications
                INNER JOIN BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
                INNER JOIN PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
                WHERE Applications.userId = ?
            `, [userId]);

        console.log("Result for user applications:", result); // Log the result for debugging

        poolConnection.close(); // Close the database connection

        if (result.length === 0) {
            console.log("No applications found for userId:", userId); // Log if no applications are found
            return res.status(404).json({ success: true, message: 'No applications found for the user', data: {applications:[]} }); // Return not found if no applications exist
        }

        // Return the fetched applications
        res.status(200).json({
            success: true,
            message: 'Applications retrieved successfully',
            data: { applications: result }
        });
    } catch (err) {
        console.error('Error fetching user applications:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: { error: err.message } }); // Return internal server error
    }
});

// Endpoint to get the percentage of approved, rejected, and pending applications
router.get('/application-percentages', async (req, res) => {
    try {
        const poolConnection = await mysql.createConnection(config); // Connect to the database

        // Query to get the total number of applications and counts for each loanStatus category
        const [result] = await poolConnection.execute(`
            SELECT 
                COUNT(*) AS totalApplications,
                SUM(CASE WHEN loanStatus = 'Accepted2' THEN 1 ELSE 0 END) AS approvedApplications,
                SUM(CASE WHEN loanStatus = 'Rejected2' THEN 1 ELSE 0 END) AS rejectedApplications,
                SUM(CASE WHEN loanStatus IN ('Pending', 'Resubmit', 'Accepted1', 'Rejected1') THEN 1 ELSE 0 END) AS pendingApplications
            FROM Applications
        `);

        poolConnection.close(); // Close the database connection

        const stats = result[0]; // Extract the statistics from the query result

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

        console.log("Application percentages calculated:", {
            approvedPercentage,
            rejectedPercentage,
            pendingPercentage
        }); // Log the calculated percentages for debugging
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

// Endpoint to get the total number of accepted applications per month for a specific year
router.get('/total-applications-per-month/:year', async (req, res) => {
    try {
        const { year } = req.params;

        // Validate year
        if (!year || isNaN(year)) {
            console.log("Invalid year provided:", year);
            return res.status(400).json({ success: false, message: "Invalid year provided" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Query to fetch the count of accepted applications grouped by month
        const [result] = await poolConnection.execute(`
                SELECT 
                    MONTH(dateSubmitted) AS month, 
                    COUNT(*) AS totalApplications
                FROM Applications
                WHERE YEAR(dateSubmitted) = ?
                GROUP BY MONTH(dateSubmitted)
            `, [year]);

        poolConnection.close();

        const data = result;

        // Initialize an array with all months and set totalApplications to 0 by default
        const months = [
            "January", "February", "March", "April", "May", "June", 
            "July", "August", "September", "October", "November", "December"
        ];

        const response = months.map((month, index) => {
            const monthData = data.find(d => d.month === index + 1);
            return {
                month,
                totalApplications: monthData ? monthData.totalApplications : 0
            };
        });

        res.status(200).json({ success: true, data: response });
    } catch (err) {
        console.error("Error fetching accepted applications per month:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
});

// Combined endpoint for application statistics
router.get('/application-stats', isAuthenticated, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        console.log("User ID from token:", userId);
        const poolConnection = await mysql.createConnection(config);
        console.log("Connected to the database");
        // Check if the user is an admin
        const [adminCheckResult] = await poolConnection.execute('SELECT adminId FROM Users WHERE userId = ?', [userId]);
        console.log("Admin check result:", adminCheckResult);
        const isAdmin = adminCheckResult.length > 0 && adminCheckResult[0].adminId;
        poolConnection.close();
        console.log("Is Admin:", isAdmin);
        let query;
        if (isAdmin) {
            // Query for overall application statistics
            query = `
                SELECT 
                    COUNT(*) AS totalApplications,
                    SUM(CASE WHEN loanStatus = 'Accepted2' THEN 1 ELSE 0 END) AS approvedApplications,
                    SUM(CASE WHEN loanStatus IN ('Rejected1', 'Rejected2') THEN 1 ELSE 0 END) AS rejectedApplications,
                    SUM(CASE WHEN loanStatus IN ('Accepted1', 'Pending', 'Resubmit') THEN 1 ELSE 0 END) AS pendingApplications
                FROM Applications
            `;
        } else {
            // Query for user-specific application statistics
            query = `
                SELECT 
                    COUNT(*) AS totalApplications,
                    SUM(CASE WHEN loanStatus = 'Accepted2' THEN 1 ELSE 0 END) AS approvedApplications,
                    SUM(CASE WHEN loanStatus IN ('Rejected1', 'Rejected2') THEN 1 ELSE 0 END) AS rejectedApplications,
                    SUM(CASE WHEN loanStatus IN ('Accepted1', 'Pending', 'Resubmit') THEN 1 ELSE 0 END) AS pendingApplications
                FROM Applications
                WHERE userId = ?
            `;
        }
        console.log("Query to be executed");
        const poolConnection1 = await mysql.createConnection(config);
        const [statsResult] = await poolConnection1.execute(query, [userId]);
        console.log("Stats result:", statsResult);
        const stats = statsResult[0];
        console.log("Final stats:", stats);
        poolConnection1.close();
        console.log("Database connection closed");
        res.status(200).json({
            success: true,
            message: 'Application statistics retrieved successfully',
            data: stats
        });
    } catch (err) {
        console.error('Error fetching application statistics:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch application statistics' });
    }
});

// Endpoint to get notifications for a user
router.get('/get-notifications/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate userId
        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Fetch notifications for the user
        const [result] = await poolConnection.execute(`
                SELECT notificationId, title, body, createdAt
                FROM Notifications
                WHERE userId = ?
                ORDER BY createdAt DESC
            `, [userId]);

        poolConnection.close();

        if (result.length === 0) {
            poolConnection.close();
            console.log("No notifications found for userId:", userId);
            return res.status(404).json({ success: true, message: "No notifications found for this user",data: [] });
        }
        const notifications = result
        poolConnection.close();
        console.log("Notifications retrieved successfully for userId:", userId);
        res.status(200).json({ success: true, message: "Notifications retrieved successfully", data: notifications });
    } catch (error) {
        console.error("Error fetching notifications:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
});

// File upload endpoint using Firebase Cloud Storage
// Upload a single file (e.g., profile picture or document)
router.post('/upload-file', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const url = await uploadFile(req.file);
        res.status(200).json({ success: true, message: 'File uploaded successfully', data: { url } });
    } catch (err) {
        console.error('File upload error:', err.message);
        res.status(500).json({ success: false, message: 'File upload failed', data: { error: err.message } });
    }
});

// List all files in Firebase Cloud Storage
router.get('/list-files', isAdmin, async (req, res) => {
    try {
        const urls = await listFiles();
        res.status(200).json({ success: true, message: 'Files listed successfully', data: { urls } });
    } catch (err) {
        console.error('List files error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to list files', data: { error: err.message } });
    }
});

// Delete a file from Firebase Cloud Storage
router.delete('/delete-file/:blobName', isAdmin, async (req, res) => {
    try {
        await deleteFile(req.params.blobName);
        res.status(200).json({ success: true, message: 'File deleted successfully' });
    } catch (err) {
        console.error('Delete file error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to delete file', data: { error: err.message } });
    }
});

export default router;