/* @flow */

import { ZalgoPromise } from 'zalgo-promise/src';
import { INTENT, SDK_QUERY_KEYS, FUNDING } from '@paypal/sdk-constants/src';

import { INTEGRATION_ARTIFACT, USER_EXPERIENCE_FLOW, PRODUCT_FLOW } from '../constants';
import { updateClientConfig, getPayee } from '../api';
import { callGraphQL } from '../api/api';
import { getLogger } from '../lib';
import { CLIENT_ID_PAYEE_NO_MATCH } from '../config';

export function updateButtonClientConfig({ orderID, fundingSource, inline = false } : { orderID : string, fundingSource : $Values<typeof FUNDING>, inline : boolean | void }) : ZalgoPromise<void> {
    return updateClientConfig({
        orderID,
        fundingSource,
        integrationArtifact: INTEGRATION_ARTIFACT.PAYPAL_JS_SDK,
        userExperienceFlow:  inline ? USER_EXPERIENCE_FLOW.INLINE : USER_EXPERIENCE_FLOW.INCONTEXT,
        productFlow:         PRODUCT_FLOW.SMART_PAYMENT_BUTTONS
    });
}

export function validateOrder(orderID : string, { clientID, merchantID } : { clientID : ?string, merchantID : $ReadOnlyArray<string> }) : ZalgoPromise<void> {
    
    // $FlowFixMe
    return ZalgoPromise.all([

        callGraphQL({
            query: `
                query GetCheckoutDetails($orderID: String!) {
                    checkoutSession(token: $orderID) {
                        cart {
                            intent
                            amounts {
                                total {
                                    currencyCode
                                }
                            }
                        }
                    }
                }
            `,
            variables: { orderID }
        }),
        
        getPayee(orderID)

    ]).then(([ gql, payee ]) => {

        const cart = gql.checkoutSession.cart;

        const intent = (cart.intent.toLowerCase() === 'sale') ? INTENT.CAPTURE : cart.intent.toLowerCase();
        const currency = cart.amounts && cart.amounts.total.currencyCode;

        const expectedIntent = intent;
        const expectedCurrency = currency;

        if (intent !== expectedIntent) {
            throw new Error(`Expected intent from order api call to be ${ expectedIntent }, got ${ intent }. Please ensure you are passing ${ SDK_QUERY_KEYS.INTENT }=${ intent } to the sdk`);
        }

        if (currency && currency !== expectedCurrency) {
            throw new Error(`Expected currency from order api call to be ${ expectedCurrency }, got ${ currency }. Please ensure you are passing ${ SDK_QUERY_KEYS.CURRENCY }=${ currency } to the sdk`);
        }

        const payeeMerchantID = payee && payee.merchant && payee.merchant.id;
        const actualMerchantID = merchantID && merchantID.length && merchantID[0];

        if (!actualMerchantID) {
            throw new Error(`Could not determine correct merchant id`);
        }

        if (!payeeMerchantID) {
            throw new Error(`No payee found in transaction. Expected ${ actualMerchantID }`);
        }

        if (payeeMerchantID !== actualMerchantID) {
            if (clientID && CLIENT_ID_PAYEE_NO_MATCH.indexOf(clientID) === -1) {
                getLogger().info(`client_id_payee_no_match_${ clientID }`).flush();
                // throw new Error(`Payee passed in transaction does not match expected merchant id: ${ actualMerchantID }`);
            }
        }

        const xpropMerchantID = window.xprops.merchantID && window.xprops.merchantID[0];
        if (xpropMerchantID && payeeMerchantID !== xpropMerchantID) {
            throw new Error(`Payee passed in transaction does not match expected merchant id: ${ xpropMerchantID }`);
        }
    });
}
