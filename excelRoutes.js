import ExcelJS from 'exceljs';
import fs from 'fs';
import express from 'express';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const config = process.env.DATABASE_URI;

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
        console.log("Checking admin status...", result.recordset[0].adminId);
        if (result.recordset.length === 0 || !result.recordset[0].adminId) {
            return res.status(403).json({ success: false, message: 'Forbidden: User is not an admin', data: {} }); // Return forbidden if the user is not an admin
        }

        next(); // Proceed to the next middleware or route handler
    } catch (err) {
        console.error('Error checking admin status:', err.message); // Log any errors
        res.status(500).json({ success: false, message: 'Internal server error', data: {} }); // Return internal server error
    }
}

// Apply the isAuthenticated and isAdmin middleware to all routes in this router
router.use(isAuthenticated, isAdmin);

// Function to generate an Excel file with detailed application data
async function generateDetailedExcel(data, filePath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Applications');

    // Define columns
    worksheet.columns = [
        { header: 'User ID', key: 'userId', width: 15 },
        { header: 'User Name', key: 'userName', width: 25 },
        { header: 'User Email', key: 'userEmail', width: 25 },
        { header: 'Application ID', key: 'applicationId', width: 15 },
        { header: 'Date Submitted', key: 'dateSubmitted', width: 20 },
        { header: 'Loan Status', key: 'loanStatus', width: 15 },
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'DOB', key: 'dob', width: 15 },
        { header: 'Gender', key: 'gender', width: 10 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Resident Address', key: 'residentAddress', width: 30 },
        { header: 'Business Name', key: 'businessName', width: 25 },
        { header: 'Business Address', key: 'businessAddress', width: 30 },
        { header: 'Business Type', key: 'businessType', width: 20 },
        { header: 'Business Industry', key: 'businessIndustry', width: 20 },
        { header: 'Biggest Challenge', key: 'biggestChallenge', width: 30 },
        { header: 'Govt Support', key: 'govtSupport', width: 30 },
        { header: 'Business Growth', key: 'businessGrowth', width: 30 },
        { header: 'Bank Account Question', key: 'bankAccountQuestion', width: 30 },
        { header: 'Digital Payment Question', key: 'digitalPaymentQuestion', width: 30 },
        { header: 'Loan Before Question', key: 'loanBeforeQuestion', width: 30 },
        { header: 'Loan How Question', key: 'loanHowQuestion', width: 30 },
        { header: 'Why No Loan', key: 'whyNoLoan', width: 30 },
        { header: 'Regulatory Challenge', key: 'regulatoryChallenge', width: 30 },
        { header: 'Uploaded Documents', key: 'uploadedDocuments', width: 50 },
    ];

    // Add rows
    data.forEach((row) => {
        worksheet.addRow({
            userId: row.userId,
            userName: row.userName,
            userEmail: row.userEmail,
            applicationId: row.applicationId,
            dateSubmitted: row.dateSubmitted,
            loanStatus: row.loanStatus,
            fullName: row.fullName,
            dob: row.dob,
            gender: row.gender,
            phone: row.phone,
            residentAddress: row.residentAddress,
            businessName: row.businessName,
            businessAddress: row.businessAddress,
            businessType: row.businessType,
            businessIndustry: row.businessIndustry,
            biggestChallenge: row.biggestChallenge,
            govtSupport: row.govtSupport,
            businessGrowth: row.businessGrowth,
            bankAccountQuestion: row.bankAccountQuestion,
            digitalPaymentQuestion: row.digitalPaymentQuestion,
            loanBeforeQuestion: row.loanBeforeQuestion,
            loanHowQuestion: row.loanHowQuestion,
            whyNoLoan: row.whyNoLoan,
            regulatoryChallenge: row.regulatoryChallenge,
            uploadedDocuments: row.uploadedDocuments || 'N/A',
        });
    });

    // Save the Excel file
    await workbook.xlsx.writeFile(filePath);
}

// Function to generate an Excel file with detailed application data for pending applications
async function generatePendingApplicationsExcel(data, filePath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pending Applications');

    // Define columns
    worksheet.columns = [
        { header: 'User ID', key: 'userId', width: 15 },
        { header: 'User Name', key: 'userName', width: 25 },
        { header: 'User Email', key: 'userEmail', width: 25 },
        { header: 'Application ID', key: 'applicationId', width: 15 },
        { header: 'Date Submitted', key: 'dateSubmitted', width: 20 },
        { header: 'Loan Status', key: 'loanStatus', width: 15 },
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'DOB', key: 'dob', width: 15 },
        { header: 'Gender', key: 'gender', width: 10 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Resident Address', key: 'residentAddress', width: 30 },
        { header: 'BVN', key: 'BVN', width: 20 },
        { header: 'NIN', key: 'NIN', width: 20 },
        { header: 'Business Name', key: 'businessName', width: 25 },
        { header: 'Business Address', key: 'businessAddress', width: 30 },
        { header: 'Business Type', key: 'businessType', width: 20 },
        { header: 'Business Industry', key: 'businessIndustry', width: 20 },
        { header: 'Biggest Challenge', key: 'biggestChallenge', width: 30 },
        { header: 'Govt Support', key: 'govtSupport', width: 30 },
        { header: 'Business Growth', key: 'businessGrowth', width: 30 },
        { header: 'Bank Account Question', key: 'bankAccountQuestion', width: 30 },
        { header: 'Digital Payment Question', key: 'digitalPaymentQuestion', width: 30 },
        { header: 'Loan Before Question', key: 'loanBeforeQuestion', width: 30 },
        { header: 'Loan How Question', key: 'loanHowQuestion', width: 30 },
        { header: 'Why No Loan', key: 'whyNoLoan', width: 30 },
        { header: 'Regulatory Challenge', key: 'regulatoryChallenge', width: 30 },
        { header: 'Id Card Link', key: 'idCardLink', width: 50 },
        { header: 'Business Certificate Link', key: 'businessCertificateLink', width: 50 },
        { header: 'CAC', key: 'CAC', width: 20 },
    ];

    // Add rows
    data.forEach((row) => {
        worksheet.addRow({
            userId: row.userId,
            userName: row.userName,
            userEmail: row.userEmail,
            applicationId: row.applicationId,
            dateSubmitted: row.dateSubmitted,
            loanStatus: row.loanStatus,
            fullName: row.fullName,
            dob: row.dob,
            gender: row.gender,
            phone: row.phone,
            residentAddress: row.residentAddress,
            BVN: row.BVN || 'N/A',
            NIN: row.NIN || 'N/A',
            businessName: row.businessName,
            businessAddress: row.businessAddress,
            businessType: row.businessType,
            businessIndustry: row.businessIndustry,
            biggestChallenge: row.biggestChallenge,
            govtSupport: row.govtSupport,
            businessGrowth: row.businessGrowth,
            bankAccountQuestion: row.bankAccountQuestion,
            digitalPaymentQuestion: row.digitalPaymentQuestion,
            loanBeforeQuestion: row.loanBeforeQuestion,
            loanHowQuestion: row.loanHowQuestion,
            whyNoLoan: row.whyNoLoan,
            regulatoryChallenge: row.regulatoryChallenge,
            idCardLink: row.idCardLink || 'N/A',
            businessCertificateLink: row.businessCertificateLink || 'N/A',
            CAC: row.CAC || 'N/A',
        });
    });

    // Save the Excel file
    await workbook.xlsx.writeFile(filePath);
}

// Endpoint to generate and download an Excel file for applications with loanStatus of Rejected1
router.get('/download-rejected1-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch all detailed data for applications with loanStatus of Accepted1
        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            WHERE Applications.loanStatus = 'Rejected1'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ success: false, error: 'No applications with loanStatus of Accepted1 found' });
        }

        const filePath = 'accepted1_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ success: false, error: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ success: false, error: 'Failed to generate Excel file' });
    }
});

// Updated query to include additional fields in the /download-rejected-applications endpoint
router.get('/download-rejected-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge,
                UploadDocuments.IdCardLink AS idCardLink,
                UploadDocuments.businessCertificateLink AS businessCertificateLink,
                UploadDocuments.CAC
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            LEFT JOIN dbo.UploadDocuments ON Applications.applicationId = UploadDocuments.applicationId
            WHERE Applications.loanStatus = 'Rejected2'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ error: 'No rejected applications found' });
        }

        const filePath = 'rejected_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ error: 'Failed to generate Excel file' });
    }
});

// Updated query to include additional fields in the /download-pending-applications endpoint
router.get('/download-pending-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge,
                UploadDocuments.IdCardLink AS idCardLink,
                UploadDocuments.businessCertificateLink AS businessCertificateLink,
                UploadDocuments.CAC
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            LEFT JOIN dbo.UploadDocuments ON Applications.applicationId = UploadDocuments.applicationId
            WHERE Applications.loanStatus = 'Pending'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ error: 'No applications with loanStatus of Pending found' });
        }

        const filePath = 'pending_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ error: 'Failed to generate Excel file' });
    }
});

// Endpoint to generate and download an Excel file for applications with loanStatus of Accepted1
router.get('/download-accepted1-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch all detailed data for applications with loanStatus of Accepted1
        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            WHERE Applications.loanStatus = 'Accepted1'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ success: false, error: 'No applications with loanStatus of Accepted1 found' });
        }

        const filePath = 'accepted1_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ success: false, error: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ success: false, error: 'Failed to generate Excel file' });
    }
});

// Endpoint to generate and download an Excel file for applications with loanStatus of Accepted1
router.get('/download-accepted-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch all detailed data for applications with loanStatus of Accepted1
        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge,
                UploadDocuments.IdCardLink AS idCardLink,
                UploadDocuments.businessCertificateLink AS businessCertificateLink,
                UploadDocuments.CAC
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            LEFT JOIN dbo.UploadDocuments ON Applications.applicationId = UploadDocuments.applicationId
            WHERE Applications.loanStatus = 'Accepted2'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ success: false, message: 'No applications with loanStatus of Accepted2 found' });
        }

        const filePath = 'accepted2_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ success: false, message: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate Excel file' });
    }
});

// Endpoint to generate and download an Excel file for applications with loanStatus of Resubmit
router.get('/download-resubmit-applications', async (req, res) => {
    try {
        const poolConnection = await sql.connect(config);

        // Query to fetch all detailed data for applications with loanStatus of Resubmit
        const result = await poolConnection.request().query(`
            SELECT 
                Users.userId,
                Users.userName,
                Users.userEmail,
                Applications.applicationId,
                Applications.dateSubmitted,
                Applications.loanStatus,
                PersonalInfo.fullName,
                PersonalInfo.dob,
                PersonalInfo.gender,
                PersonalInfo.phone,
                PersonalInfo.residentAddress,
                PersonalInfo.BVN,
                PersonalInfo.NIN,
                PersonalInfo.LGA,
                PersonalInfo.state,
                BusinessInfo.businessName,
                BusinessInfo.businessAddress,
                BusinessInfo.businessType,
                BusinessInfo.businessIndustry,
                BusinessInfo.businessAge,
                BusinessInfo.businessLGA,
                BusinessInfo.businessTown,
                ChallengeInfo.biggestChallengeQuestion AS biggestChallenge,
                ChallengeInfo.govtSupportQuestion AS govtSupport,
                ChallengeInfo.businessGrowthQuestion AS businessGrowth,
                FinanceInfo.bankAccountQuestion,
                FinanceInfo.digitalPaymentQuestion,
                FinanceInfo.businessFinanceQuestion,
                LoanInfo.loanBeforeQuestion,
                LoanInfo.loanHowQuestion,
                LoanInfo.whyNoLoan,
                RegulatoryInfo.regulatoryChallengeQuestion AS regulatoryChallenge,
                UploadDocuments.IdCardLink AS idCardLink,
                UploadDocuments.businessCertificateLink AS businessCertificateLink,
                UploadDocuments.CAC
            FROM dbo.Applications
            INNER JOIN dbo.Users ON Applications.userId = Users.userId
            INNER JOIN dbo.PersonalInfo ON Applications.applicationId = PersonalInfo.applicationId
            INNER JOIN dbo.BusinessInfo ON Applications.applicationId = BusinessInfo.applicationId
            INNER JOIN dbo.ChallengeInfo ON Applications.applicationId = ChallengeInfo.applicationId
            INNER JOIN dbo.FinanceInfo ON Applications.applicationId = FinanceInfo.applicationId
            INNER JOIN dbo.LoanInfo ON Applications.applicationId = LoanInfo.applicationId
            INNER JOIN dbo.RegulatoryInfo ON Applications.applicationId = RegulatoryInfo.applicationId
            LEFT JOIN dbo.UploadDocuments ON Applications.applicationId = UploadDocuments.applicationId
            WHERE Applications.loanStatus = 'Resubmit'
        `);

        poolConnection.close();

        const data = result.recordset;

        if (data.length === 0) {
            return res.status(404).json({ error: 'No applications with loanStatus of Resubmit found' });
        }

        const filePath = 'resubmit_applications.xlsx';
        await generatePendingApplicationsExcel(data, filePath);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to download Excel file' });
            }

            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error deleting file:', unlinkErr);
                }
            });
        });
    } catch (err) {
        console.error('Error generating Excel file:', err.message);
        res.status(500).json({ error: 'Failed to generate Excel file' });
    }
});

export default router;