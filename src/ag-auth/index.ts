import { AuthTokenError, InvalidArgumentsError } from '../sc-errors/errors';
import { JwtAlgorithm, JwtPayload, JwtSignOptions, JwtVerifyOptions, sign, verify } from '../jwt';

export class AuthEngine
{
    verifyToken(signedToken: string, secret: string|JsonWebKey, options: JwtVerifyOptions|JwtAlgorithm): Promise<string>
    {
        options        = options || {};
        let jwtOptions = Object.assign({}, options) as any;
        delete jwtOptions.socket;

        if (typeof signedToken === 'string' || signedToken == null)
        {
            return new Promise((resolve, reject) =>
            {
                verify(signedToken, secret, jwtOptions)
                    .then(isValid =>
                    {
                        if (isValid)
                        {
                            resolve(signedToken);
                        }
                        else
                        {
                            reject(new AuthTokenError(`Invalid token`));
                        }
                    })
                    .catch(err => reject(err));
            });
        }
        return Promise.reject(
            new InvalidArgumentsError('Invalid token format - Token must be a string')
        );
    }

    signToken(token: JwtPayload, secret: string|JsonWebKey, options: JwtSignOptions|JwtAlgorithm): Promise<string|undefined>
    {
        options = options || {};
        let jwtOptions = Object.assign({}, options);
        return new Promise((resolve, reject) => {
            sign(token, secret, jwtOptions)
                .then(token =>
                {
                    if (token)
                    {
                        resolve(token);
                    }
                    else
                    {
                        reject(new AuthTokenError(`Sign token error`));
                    }
                })
                .catch(err => reject(err));
        });
    }
}
