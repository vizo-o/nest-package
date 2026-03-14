import {
    isEmployeeUser,
    sanitizeContext,
    sanitizeJsonString,
} from '../../../src/logger-v2/utils/sanitize'

describe('isEmployeeUser', () => {
    describe('Email domain detection', () => {
        it('should return true for @vizo-o.com emails', () => {
            expect(isEmployeeUser('user@vizo-o.com')).toBe(true)
            expect(isEmployeeUser('admin@vizo-o.com')).toBe(true)
        })

        it('should return false for non-vizo emails', () => {
            expect(isEmployeeUser('user@example.com')).toBe(false)
            expect(isEmployeeUser('customer@gmail.com')).toBe(false)
        })

        it('should return false for undefined email', () => {
            expect(isEmployeeUser(undefined)).toBe(false)
        })
    })

    describe('Role-based detection', () => {
        it('should return true for employee roles', () => {
            expect(isEmployeeUser('user@example.com', ['admin'])).toBe(true)
            expect(isEmployeeUser('user@example.com', ['vizoIntaker'])).toBe(
                true,
            )
            expect(isEmployeeUser('user@example.com', ['doctor'])).toBe(true)
            expect(isEmployeeUser('user@example.com', ['formsAdmin'])).toBe(
                true,
            )
        })

        it('should return false for non-employee roles', () => {
            expect(isEmployeeUser('user@example.com', ['customer'])).toBe(false)
            expect(isEmployeeUser('user@example.com', [])).toBe(false)
        })

        it('should return true if any role is employee role', () => {
            expect(
                isEmployeeUser('user@example.com', ['customer', 'admin']),
            ).toBe(true)
        })
    })
})

describe('sanitizeJsonString', () => {
    it('should sanitize JSON string with sensitive data', () => {
        const jsonString = JSON.stringify({
            username: 'test',
            password: 'secret123',
            email: 'test@example.com',
        })
        const sanitized = sanitizeJsonString(jsonString)
        const parsed = JSON.parse(sanitized)
        expect(parsed.password).toBe('[REDACTED]')
        expect(parsed.username).toBe('test')
    })

    it('should preserve employee emails in JSON string', () => {
        const jsonString = JSON.stringify({
            email: 'employee@vizo-o.com',
            password: 'secret',
        })
        const sanitized = sanitizeJsonString(jsonString, 'employee@vizo-o.com')
        const parsed = JSON.parse(sanitized)
        expect(parsed.email).toBe('employee@vizo-o.com')
        expect(parsed.password).toBe('[REDACTED]')
    })

    it('should redact customer emails in JSON string', () => {
        const jsonString = JSON.stringify({
            email: 'customer@example.com',
        })
        const sanitized = sanitizeJsonString(jsonString)
        const parsed = JSON.parse(sanitized)
        expect(parsed.email).toMatch(/^c\*{1,4}@example\.com$/)
    })

    it('should handle invalid JSON gracefully', () => {
        const invalidJson = 'not valid json {'
        const sanitized = sanitizeJsonString(invalidJson)
        expect(sanitized).toBe(invalidJson)
    })

    it('should handle empty string', () => {
        expect(sanitizeJsonString('')).toBe('')
    })
})

describe('sanitizeContext', () => {
    describe('Password sanitization', () => {
        it('should sanitize password field', () => {
            const context = {
                username: 'testuser',
                password: 'secret123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.password).toBe('[REDACTED]')
            expect(sanitized.username).toBe('testuser')
        })

        it('should sanitize password in nested objects', () => {
            const context = {
                user: {
                    name: 'John',
                    password: 'secret123',
                },
            }
            const sanitized = sanitizeContext(context)
            expect((sanitized.user as Record<string, unknown>).password).toBe(
                '[REDACTED]',
            )
            expect((sanitized.user as Record<string, unknown>).name).toBe(
                'John',
            )
        })

        it('should sanitize case-insensitive password fields', () => {
            const context = {
                Password: 'secret123',
                PASSWORD: 'secret456',
                userPassword: 'secret789',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.Password).toBe('[REDACTED]')
            expect(sanitized.PASSWORD).toBe('[REDACTED]')
            expect(sanitized.userPassword).toBe('[REDACTED]')
        })
    })

    describe('Token sanitization', () => {
        it('should sanitize token field', () => {
            const context = {
                token: 'abc123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.token).toBe('[REDACTED]')
        })

        it('should sanitize accessToken', () => {
            const context = {
                accessToken: 'token123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.accessToken).toBe('[REDACTED]')
        })

        it('should sanitize refreshToken', () => {
            const context = {
                refreshToken: 'refresh123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.refreshToken).toBe('[REDACTED]')
        })

        it('should sanitize authToken', () => {
            const context = {
                authToken: 'auth123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.authToken).toBe('[REDACTED]')
        })
    })

    describe('Authorization header sanitization', () => {
        it('should sanitize authorization header', () => {
            const context = {
                authorization: 'Bearer token123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.authorization).toBe('[REDACTED]')
        })

        it('should sanitize cookie field', () => {
            const context = {
                cookie: 'session=abc123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.cookie).toBe('[REDACTED]')
        })
    })

    describe('PII sanitization', () => {
        it('should sanitize SSN', () => {
            const context = {
                ssn: '123-45-6789',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.ssn).toBe('[REDACTED]')
        })

        it('should sanitize socialSecurityNumber', () => {
            const context = {
                socialSecurityNumber: '123-45-6789',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.socialSecurityNumber).toBe('[REDACTED]')
        })

        it('should sanitize creditCard', () => {
            const context = {
                creditCard: '4111-1111-1111-1111',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.creditCard).toBe('[REDACTED]')
        })

        it('should sanitize CVV', () => {
            const context = {
                cvv: '123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.cvv).toBe('[REDACTED]')
        })

        it('should sanitize PIN', () => {
            const context = {
                pin: '1234',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.pin).toBe('[REDACTED]')
        })
    })

    describe('Secret sanitization', () => {
        it('should sanitize secret field', () => {
            const context = {
                secret: 'mysecret',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.secret).toBe('[REDACTED]')
        })

        it('should sanitize apiKey', () => {
            const context = {
                apiKey: 'key123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.apiKey).toBe('[REDACTED]')
        })

        it('should sanitize privateKey', () => {
            const context = {
                privateKey: 'key123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.privateKey).toBe('[REDACTED]')
        })

        it('should sanitize credentials', () => {
            const context = {
                credentials: 'creds123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.credentials).toBe('[REDACTED]')
        })
    })

    describe('Edge cases', () => {
        it('should handle null context', () => {
            const sanitized = sanitizeContext(
                null as unknown as Record<string, unknown>,
            )
            expect(sanitized).toEqual({})
        })

        it('should handle undefined context', () => {
            const sanitized = sanitizeContext(
                undefined as unknown as Record<string, unknown>,
            )
            expect(sanitized).toEqual({})
        })

        it('should handle non-object context', () => {
            const sanitized = sanitizeContext(
                'not an object' as unknown as Record<string, unknown>,
            )
            expect(sanitized).toEqual({})
        })

        it('should preserve non-sensitive fields', () => {
            const context = {
                username: 'testuser',
                email: 'test@example.com',
                age: 30,
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.username).toBe('testuser')
            // Email is redacted unless it's an employee email or in a customer object
            expect(sanitized.email).toMatch(/^t\*{1,4}@example\.com$/)
            expect(sanitized.age).toBe(30)
        })

        it('should handle arrays', () => {
            const context = {
                items: [1, 2, 3],
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.items).toEqual([1, 2, 3])
        })

        it('should sanitize sensitive data in arrays', () => {
            const context = {
                users: [
                    { name: 'John', password: 'secret1' },
                    { name: 'Jane', password: 'secret2' },
                ],
            }
            const sanitized = sanitizeContext(context)
            const users = sanitized.users as Array<Record<string, unknown>>
            expect(users[0].password).toBe('[REDACTED]')
            expect(users[1].password).toBe('[REDACTED]')
            expect(users[0].name).toBe('John')
            expect(users[1].name).toBe('Jane')
        })

        it('should handle deeply nested objects', () => {
            const context = {
                level1: {
                    level2: {
                        level3: {
                            password: 'secret',
                            data: 'safe',
                        },
                    },
                },
            }
            const sanitized = sanitizeContext(context)
            expect(
                (
                    (
                        (sanitized.level1 as Record<string, unknown>)
                            .level2 as Record<string, unknown>
                    ).level3 as Record<string, unknown>
                ).password,
            ).toBe('[REDACTED]')
            expect(
                (
                    (
                        (sanitized.level1 as Record<string, unknown>)
                            .level2 as Record<string, unknown>
                    ).level3 as Record<string, unknown>
                ).data,
            ).toBe('safe')
        })
    })

    describe('Email sanitization', () => {
        it('should preserve employee emails', () => {
            const context = {
                email: 'employee@vizo-o.com',
            }
            const sanitized = sanitizeContext(context, 'employee@vizo-o.com', [
                'admin',
            ])
            expect(sanitized.email).toBe('employee@vizo-o.com')
        })

        it('should preserve employee emails based on role', () => {
            const context = {
                email: 'employee@vizo-o.com',
            }
            const sanitized = sanitizeContext(context, undefined, ['admin'])
            expect(sanitized.email).toBe('employee@vizo-o.com')
        })

        it('should redact customer emails', () => {
            const context = {
                email: 'customer@example.com',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.email).toMatch(/^c\*{1,4}@example\.com$/)
        })

        it('should redact customer emails even with userEmail provided', () => {
            const context = {
                email: 'customer@example.com',
            }
            const sanitized = sanitizeContext(context, 'employee@vizo-o.com', [
                'admin',
            ])
            // The email value itself is checked, not the userEmail parameter
            // So customer@example.com should be redacted
            expect(sanitized.email).toMatch(/^c\*{1,4}@example\.com$/)
        })
    })

    describe('Phone number sanitization', () => {
        it('should partially redact phone numbers', () => {
            const context = {
                phone: '+1-555-123-4567',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.phone).toBe('***-***-4567')
        })

        it('should redact phoneNumber field', () => {
            const context = {
                phoneNumber: '5551234567',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.phoneNumber).toBe('***-***-4567')
        })

        it('should redact mobile field', () => {
            const context = {
                mobile: '555-123-4567',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.mobile).toBe('***-***-4567')
        })

        it('should handle short phone numbers', () => {
            const context = {
                phone: '123',
            }
            const sanitized = sanitizeContext(context)
            expect(sanitized.phone).toBe('[REDACTED]')
        })
    })

    describe('Customer object sanitization', () => {
        it('should preserve vizoId and redact PII', () => {
            const context = {
                customer: {
                    vizoId: 'Vi-005879',
                    email: 'customer@example.com',
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '555-123-4567',
                },
            }
            const sanitized = sanitizeContext(context)
            const customer = sanitized.customer as Record<string, unknown>
            expect(customer.vizoId).toBe('Vi-005879')
            expect(customer.email).toMatch(/^c\*{1,4}@example\.com$/)
            expect(customer.firstName).toBe('[REDACTED]')
            expect(customer.lastName).toBe('[REDACTED]')
            expect(customer.phone).toBe('***-***-4567')
        })

        it('should preserve customerExternalId', () => {
            const context = {
                customer: {
                    customerExternalId: 'EXT-123',
                    email: 'customer@example.com',
                    firstName: 'John',
                },
            }
            const sanitized = sanitizeContext(context)
            const customer = sanitized.customer as Record<string, unknown>
            expect(customer.customerExternalId).toBe('EXT-123')
            expect(customer.firstName).toBe('[REDACTED]')
        })

        it('should preserve non-PII metadata', () => {
            const context = {
                customer: {
                    vizoId: 'Vi-005879',
                    saleStatus: 'completed',
                    processManager: 'vizo',
                    isVip: true,
                    email: 'customer@example.com',
                },
            }
            const sanitized = sanitizeContext(context)
            const customer = sanitized.customer as Record<string, unknown>
            expect(customer.vizoId).toBe('Vi-005879')
            expect(customer.saleStatus).toBe('completed')
            expect(customer.processManager).toBe('vizo')
            expect(customer.isVip).toBe(true)
            expect(customer.email).toMatch(/^c\*{1,4}@example\.com$/)
        })

        it('should handle nested customer objects', () => {
            const context = {
                data: {
                    customer: {
                        vizoId: 'Vi-005879',
                        email: 'customer@example.com',
                        firstName: 'John',
                    },
                },
            }
            const sanitized = sanitizeContext(context)
            const customer = (sanitized.data as Record<string, unknown>)
                .customer as Record<string, unknown>
            expect(customer.vizoId).toBe('Vi-005879')
            expect(customer.email).toMatch(/^c\*{1,4}@example\.com$/)
            expect(customer.firstName).toBe('[REDACTED]')
        })

        it('should handle customer objects in arrays', () => {
            const context = {
                customers: [
                    {
                        vizoId: 'Vi-005879',
                        email: 'customer1@example.com',
                        firstName: 'John',
                    },
                    {
                        vizoId: 'Vi-005880',
                        email: 'customer2@example.com',
                        firstName: 'Jane',
                    },
                ],
            }
            const sanitized = sanitizeContext(context)
            const customers = sanitized.customers as Array<
                Record<string, unknown>
            >
            expect(customers[0].vizoId).toBe('Vi-005879')
            expect(customers[0].email).toMatch(/^c\*{1,4}@example\.com$/)
            expect(customers[0].firstName).toBe('[REDACTED]')
            expect(customers[1].vizoId).toBe('Vi-005880')
        })

        it('should preserve employee email in customer object if user is employee', () => {
            const context = {
                customer: {
                    vizoId: 'Vi-005879',
                    email: 'employee@vizo-o.com',
                    firstName: 'John',
                },
            }
            const sanitized = sanitizeContext(context, 'employee@vizo-o.com', [
                'admin',
            ])
            const customer = sanitized.customer as Record<string, unknown>
            expect(customer.vizoId).toBe('Vi-005879')
            expect(customer.email).toBe('employee@vizo-o.com')
            expect(customer.firstName).toBe('[REDACTED]')
        })
    })

    describe('Authorization token redaction', () => {
        it('should redact Authorization header', () => {
            const context = {
                headers: {
                    Authorization:
                        'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
                    'Content-Type': 'application/json',
                },
            }
            const sanitized = sanitizeContext(context)
            const headers = sanitized.headers as Record<string, unknown>
            expect(headers.Authorization).toBe('[REDACTED]')
            expect(headers['Content-Type']).toBe('application/json')
        })

        it('should redact authorization in nested objects', () => {
            // Note: payloadInfo as JSON string would need sanitizeJsonString
            // but we test nested object sanitization here
            const context2 = {
                payload: {
                    headers: {
                        Authorization: 'Bearer token123',
                    },
                },
            }
            const sanitized = sanitizeContext(context2)
            const headers = (sanitized.payload as Record<string, unknown>)
                .headers as Record<string, unknown>
            expect(headers.Authorization).toBe('[REDACTED]')
        })
    })
})
