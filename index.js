const { Sequelize, DataTypes } = require('sequelize');
const uuid = require('uuid');
const sendgridMail = require('@sendgrid/mail');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns'); 
const { QueryTypes } = require('sequelize');  
require('dotenv').config();

sendgridMail.setApiKey(process.env.SENDGRID_API_KEY);

const region = process.env.AWS_REGION;

const snsClient = new SNSClient({
    region: region, 
});
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
});

async function sendVerificationEmail(event) {
    const messagePayload = JSON.parse(event.Records[0].Sns.Message);
    const { firstName, lastName, email } = messagePayload;
    const verificationToken = uuid.v4();
    const verificationUrl = `http://${process.env.DOMAIN}/v1/user/checkemail?token=${verificationToken}`;
    let emailStatus = 'Pending';
    let response;

    let userEmail = '';
    try {
        const user = await sequelize.query(
            'SELECT email FROM Users WHERE email = :email',
            {
                replacements: { email },  
                type: QueryTypes.SELECT,
            }
        );

        if (user && user.length > 0) {
            userEmail = user[0].email; 
        } else {
            throw new Error(`User with email ${email} not found`);
        }
    } catch (error) {
        console.error(`Error fetching user details: ${error.message}`);
        emailStatus = 'Failed';
    }

    if (emailStatus === 'Pending') {
        const msgdata = {
            to: userEmail,  
            from: `noreply@${process.env.DOMAIN}`,
            subject: 'Verify Your Email Address',
            text: `Hello ${firstName} ${lastName},\n\nPlease click the link below to verify your email address:\n\n${verificationUrl}`,
            html: `<strong>Hello ${firstName} ${lastName},</strong><br><br>Please click the link below to verify your email address:<br><br><a href="${verificationUrl}">${verificationUrl}</a>`,
        };

        try {
            response = await sendgridMail.send(msgdata);
            emailStatus = 'Sent';
        } catch (error) {
            emailStatus = 'Failed';
            console.error(`Failed to send email: ${error.message}`);
        }
    }

    if (emailStatus === 'Sent') {
        const verificationTokenExpires = new Date(Date.now() + 120000); 
        try {
            const [user] = await sequelize.query(
                'SELECT * FROM Users WHERE email = :email',
                {
                    replacements: { email },
                    type: QueryTypes.SELECT,
                }
            );

            if (user) {
                await sequelize.query(
                    'UPDATE Users SET verification_token = :verificationToken, verification_token_expires = :verificationTokenExpires WHERE email = :email',
                    {
                        replacements: {
                            verificationToken,
                            verificationTokenExpires,
                            email,
                        },
                        type: QueryTypes.UPDATE,
                    }
                );
                console.info(`Updated user verification details for ${email}`);
            } else {
                throw new Error(`User with email ${email} not found`);
            }
        } catch (dbError) {
            console.error(`Failed to update user verification details in DB for ${email}: ${dbError.message}`);
            throw dbError; 
        }
    }

    try {
        await sequelize.query(
            'INSERT INTO EmailData (email, verificationLink, status, sentDate) VALUES (:email, :verificationLink, :status, :sentDate)',
            {
                replacements: {
                    email,
                    verificationLink: verificationUrl,
                    status: emailStatus,
                    sentDate: new Date(),
                },
                type: QueryTypes.INSERT,
            }
        );
        console.info(`Email event logged for ${email}`);
    } catch (logError) {
        console.error(`Failed to log email event for ${email}: ${logError.message}`);
    }

    const snsTopicArn = process.env.SNS_TOPIC_ARN;

    if (!snsTopicArn) {
        console.error('SNS_TOPIC_ARN is not defined in environment variables');
        return;
    }

    const snsMessage = {
        Message: `Verification email sent to ${userEmail} with status: ${emailStatus}`,
        TopicArn: snsTopicArn,
    };

    try {
        const snsCommand = new PublishCommand(snsMessage); 
        await snsClient.send(snsCommand);
        console.info('Published message to SNS');
    } catch (snsError) {
        console.error(`Failed to publish to SNS: ${snsError.message}`);
    }
}

exports.handler = async (event) => {
    try {
        await sendVerificationEmail(event);
    } catch (error) {
        console.error('Error in Lambda function:', error.message);
    }
};
