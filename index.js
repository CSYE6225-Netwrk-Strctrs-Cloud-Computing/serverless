const { Sequelize, DataTypes } = require('sequelize');
const uuid = require('uuid');
const sendgridMail = require('@sendgrid/mail');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns'); 
const { QueryTypes } = require('sequelize');  
require('dotenv').config();
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const region = process.env.AWS_REGION;

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

const snsClient = new SNSClient({
    region: region, 
});

async function getSecrets(secretName) {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsClient.send(command);

    if (response.SecretString) {
        return JSON.parse(response.SecretString);
    }
    throw new Error('Secret is not in string format');
}

async function sendVerificationEmail(event, secrets) {
    sendgridMail.setApiKey(secrets.SENDGRID_API_KEY);  

    const messagePayload = JSON.parse(event.Records[0].Sns.Message);
    const { firstName, lastName, email } = messagePayload;
    const verificationToken = uuid.v4();
    const verificationUrl = `https://${secrets.DOMAIN}/v1/user/checkemail?token=${verificationToken}`;
    let emailStatus = 'Pending';

    const sequelize = new Sequelize(secrets.DATABASE_NAME, secrets.DATABASE_USERNAME, secrets.DATABASE_PASSWORD, {
        host: secrets.DATABASE_HOST,
        dialect: 'mysql',
    });

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
            from: `noreply@${secrets.DOMAIN}`,
            subject: 'Verify Your Email Address',
            text: `Hello ${firstName} ${lastName},\n\nPlease click the link below to verify your email address:\n\n${verificationUrl}`,
            html: `<strong>Hello ${firstName} ${lastName},</strong><br><br>Please click the link below to verify your email address:<br><br><a href="${verificationUrl}">${verificationUrl}</a>`,
        };

        try {
            await sendgridMail.send(msgdata);
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

    const snsTopicArn = secrets.SNS_TOPIC_ARN;

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
        const secretName = process.env.SECRET_NAME;
        const secrets = await getSecrets(secretName); 
        console.log('Fetched secrets:', secrets);
        await sendVerificationEmail(event, secrets);
    } catch (error) {
        console.error('Error in Lambda function:', error.message);
    }
};