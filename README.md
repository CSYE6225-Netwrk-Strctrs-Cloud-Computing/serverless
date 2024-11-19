# serverless Send Verification Email AWS Lambda 

This AWS Lambda function sends email verification links to users upon receiving an SNS message. It generates a unique verification link, sends the email using SendGrid, and logs the details in an RDS database. The verification link expires after 2 minutes.

## Features  

- **Email Verification**: Sends a unique email verification link to users.
- **Database Integration**: Updates user verification status and tracks email activity in an RDS database.
- **Expiration**: Verification links expire after 2 minutes.
- **Error Logging**: Handles errors during email sending or database updates and logs them.


### Prerequisites  

1. **AWS Resources**:  
   - Amazon SNS for triggering the Lambda function.  
   - SendGrid for sending emails (via SendGrid API).  
   - Amazon RDS for storing user and email logs.

2. **Dependencies**:  
   Install the following npm packages before deployment:  
   ```bash  
   npm install uuid mysql2 dotenv aws-sdk @sendgrid/mail  
   ```


## Workflow  

1. **Trigger**: The Lambda function is invoked by an SNS topic when a new user account is created.
2. **Parse Message**: Extract user details from the SNS payload.
3. **Generate Link**: Creates a unique token for email verification and generates a verification link.
4. **Send Email**: Uses SendGrid API to send the verification email to the user.
5. **Update Database**: Stores the verification token, expiration time, and email status in the RDS database.
6. **Log Email Activity**: Logs the status of the email (Sent/Failed) and other details in the email logs table.

---
