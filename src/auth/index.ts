import { AuthTokenError, InvalidArgumentsError } from '../errors/errors';
import {
    JwtPayload,
    JwtSignOptions,
    JwtVerifyOptions,
    JwtSecret,
    sign,
    verify,
} from '@topgunbuild/jsonwebtoken';

export class AuthEngine
{
    verifyToken?(
        signedToken: string,
        secret: JwtSecret,
        options?: JwtVerifyOptions
    ): Promise<JwtPayload>
    {
        options = options || {};
        const jwtOptions = Object.assign({}, options) as any;
        delete jwtOptions.socket;

        if (typeof signedToken === 'string' || signedToken == null)
        {
            return new Promise((resolve, reject) =>
            {
                verify(signedToken, secret, jwtOptions)
                    .then((payload: JwtPayload) =>
                    {
                        if (payload)
                        {
                            resolve(payload);
                        }
                        else
                        {
                            reject(new AuthTokenError('Invalid token'));
                        }
                    })
                    .catch(err => reject(err));
            });
        }
        return Promise.reject(
            new InvalidArgumentsError(
                'Invalid token format - Token must be a string'
            )
        );
    }

    signToken?(
        token: JwtPayload,
        secret: JwtSecret,
        options: JwtSignOptions
    ): Promise<string | undefined>
    {
        options = options || {};
        const jwtOptions = Object.assign({}, options);
        return new Promise((resolve, reject) =>
        {
            sign(token, secret, jwtOptions)
                .then((token) =>
                {
                    if (token)
                    {
                        resolve(token);
                    }
                    else
                    {
                        reject(new AuthTokenError('Sign token error'));
                    }
                })
                .catch(err => reject(err));
        });
    }
}
